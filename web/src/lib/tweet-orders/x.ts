import { MEDIA_BUCKET, TweetOrder } from './model';
import { ApiError, db, env } from './server';

class XError extends ApiError { constructor(message: string, public uncertain = false) { super(message, 502); } }
async function accessToken(value: TweetOrder) {
  const client = db();
  const target = value.target_x_user_id;
  const current = target
    ? await client.from('business_x_accounts').select('*').eq('x_user_id', target).maybeSingle()
    : await client.from('business_x_accounts').select('*').eq('username', 'lumenless').maybeSingle();
  if (current.error) throw new ApiError('Could not load X connection.', 503);
  const table = current.data || target ? 'business_x_accounts' : 'tweet_x_credentials';
  const key = table === 'business_x_accounts' ? 'x_user_id' : 'id';
  const credentialId = current.data?.x_user_id || target || 1;
  const initial = table === 'business_x_accounts' ? current : await client.from(table).select('*').eq(key, credentialId).maybeSingle();
  const data = initial.data;
  if (initial.error || !data) throw new ApiError('X connection is unavailable. Reconnect in Business.', 503);
  if (Date.parse(data.expires_at) > Date.now() + 120_000) return { token: data.access_token as string, paidPartnership: data.paid_partnership !== false };
  const lock = new Date(Date.now() + 60_000).toISOString();
  const acquired = await client.from(table).update({ lock_until: lock }).eq(key, credentialId).lt('lock_until', new Date().toISOString()).select().maybeSingle();
  if (acquired.error || !acquired.data) throw new ApiError('X authorization is refreshing. Retry shortly.', 409);
  try {
    const response = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST', signal: AbortSignal.timeout(20_000), headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${encodeURIComponent(env('X_CLIENT_ID'))}:${encodeURIComponent(env('X_CLIENT_SECRET'))}`).toString('base64')}`,
      }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: acquired.data.refresh_token }),
    });
    if (!response.ok) throw new ApiError('X authorization expired or was revoked. Reconnect the account in Business.', 503);
    const refreshed = await response.json();
    if (!refreshed.access_token || !refreshed.refresh_token || !refreshed.expires_in) throw new ApiError('X returned invalid credentials.', 503);
    const saved = await client.from(table).update({ access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), lock_until: '1970-01-01' }).eq(key, credentialId).eq('lock_until', lock);
    if (saved.error) throw new ApiError('Could not persist rotated X credentials. Reconnect the account in Business.', 503);
    return { token: refreshed.access_token as string, paidPartnership: data.paid_partnership !== false };
  } finally {
    await client.from(table).update({ lock_until: '1970-01-01' }).eq(key, credentialId).eq('lock_until', lock);
  }
}
async function xFetch(path: string, token: string, init: RequestInit = {}, post = false) {
  let response: Response;
  try { response = await fetch(`https://api.x.com/2${path}`, { ...init, signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${token}`, ...init.headers } }); }
  catch { throw new XError('X did not return a response. Check the publication before retrying.', post); }
  if (!response.ok) throw new XError(`X request failed (HTTP ${response.status}).`, post && (response.status >= 500 || response.status === 408));
  if (response.status === 204 || response.headers.get('content-length') === '0') return {};
  try { return await response.json(); } catch { if (post) throw new XError('X returned an unreadable publication result.', true); return {}; }
}
async function save(value: TweetOrder, patch: Record<string, unknown>) {
  const { data, error } = await db().from('tweet_orders').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', value.id).eq('status', 'publishing').select().maybeSingle();
  if (error || !data) throw new XError('Could not save publishing progress.', value.publish_attempt !== null);
  Object.assign(value, data);
}
async function uploadMedia(value: TweetOrder, file: TweetOrder['tweets'][number]['media'][number], token: string) {
  let media = value.x_media[file.path];
  if (!media || media.expires < Date.now() + 60_000) {
    const { data, error } = await db().storage.from(MEDIA_BUCKET).download(file.path);
    if (error || !data) throw new XError('Could not download order media.');
    const initialized = await xFetch('/media/upload/initialize', token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: file.type, total_bytes: data.size, media_category: file.type.startsWith('video/') ? 'tweet_video' : 'tweet_image' }) });
    const id = initialized.data?.id;
    if (!id) throw new XError('X did not return a media ID.');
    const chunkSize = 4 * 1024 * 1024;
    for (let offset = 0, segment = 0; offset < data.size; offset += chunkSize, segment++) {
      const form = new FormData(); form.set('segment_index', String(segment)); form.set('media', data.slice(offset, offset + chunkSize), 'chunk');
      await xFetch(`/media/upload/${id}/append`, token, { method: 'POST', body: form });
    }
    const finalized = await xFetch(`/media/upload/${id}/finalize`, token, { method: 'POST' });
    const processing = finalized.data?.processing_info;
    if (processing?.state === 'failed') throw new XError('X rejected this media file.');
    media = { id, ready: !processing || processing.state === 'succeeded', expires: Date.now() + Number(finalized.data?.expires_after_secs || initialized.data?.expires_after_secs || 3600) * 1000 };
    value.x_media[file.path] = media;
    await save(value, { x_media: value.x_media });
  }
  if (!media.ready) {
    const result = await xFetch(`/media/upload?command=STATUS&media_id=${encodeURIComponent(media.id)}`, token);
    const state = result.data?.processing_info?.state;
    if (state === 'failed') throw new XError('X rejected this video.');
    if (state !== 'succeeded') return null;
    media.ready = true;
    await save(value, { x_media: value.x_media });
  }
  return media.id;
}
export async function publish(id: string) {
  // A persisted intent marker precedes each POST. Unknown outcomes require reconciliation, never blind retries.
  const target = await db().from('tweet_orders').select('*').eq('id', id).maybeSingle();
  if (target.error || !target.data) throw new ApiError('Order not found.', 404);
  const { token, paidPartnership } = await accessToken(target.data);
  const account = await xFetch('/users/me', token);
  if (target.data.target_x_user_id ? account.data?.id !== target.data.target_x_user_id : account.data?.username?.toLowerCase() !== 'lumenless') throw new ApiError('The X connection does not match this order.', 503);
  const { data, error } = await db().from('tweet_orders').update({ paid_partnership: target.data.paid_partnership ?? paidPartnership, status: 'publishing', updated_at: new Date().toISOString(), publish_error: null })
    .eq('id', id).eq('status', 'approved').select().maybeSingle();
  if (error || !data) throw new ApiError('This order is already publishing or is not approved.', 409);
  const value = data as TweetOrder;
  try {
    for (let index = value.published_ids.length; index < value.tweets.length; index++) {
      const tweet = value.tweets[index]; const mediaIds: string[] = [];
      for (const file of tweet.media) {
        const mediaId = await uploadMedia(value, file, token);
        if (!mediaId) { await save(value, { status: 'approved', publish_error: 'Video is processing. Publication will continue automatically.' }); return; }
        mediaIds.push(mediaId);
      }
      await save(value, { publish_attempt: index });
      const result = await xFetch('/tweets', token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid_partnership: value.paid_partnership, text: tweet.text || undefined, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
          ...(index ? { reply: { in_reply_to_tweet_id: value.published_ids[index - 1] } } : {}) }) }, true);
      if (!/^\d+$/.test(result.data?.id || '')) throw new XError('X returned no post ID. Check the target X account before retrying.', true);
      value.published_ids.push(result.data.id);
      await save(value, { published_ids: value.published_ids, publish_attempt: null });
    }
    await save(value, { status: 'published', published_url: `https://x.com/${value.target_username || 'lumenless'}/status/${value.published_ids[0]}`, publish_error: null });
  } catch (error) {
    const uncertain = error instanceof XError && error.uncertain;
    await save(value, { status: uncertain ? 'publish_uncertain' : 'publish_failed', publish_attempt: uncertain ? value.publish_attempt : null,
      publish_error: error instanceof Error ? error.message : 'Publication failed.' });
    throw error;
  }
}
export async function reconcile(value: TweetOrder, postId: string) {
  if (value.status !== 'publish_uncertain' || value.publish_attempt !== value.published_ids.length)
    throw new ApiError('This order does not need reconciliation.', 409);
  if (!/^\d{1,30}$/.test(postId)) throw new ApiError('Enter the published X post ID.');
  const { token } = await accessToken(value);
  const account = await xFetch('/users/me', token);
  const post = await xFetch(`/tweets/${postId}?tweet.fields=author_id,referenced_tweets`, token);
  const index = value.published_ids.length;
  if ((value.target_x_user_id ? account.data?.id !== value.target_x_user_id : account.data?.username?.toLowerCase() !== 'lumenless') || post.data?.author_id !== account.data.id)
    throw new ApiError('This post must belong to the account targeted by this order.');
  const expected = value.tweets[index].text;
  // X rewrites URLs, so exact text reconciliation is limited to text without URLs.
  if (!expected.includes('http') && post.data?.text !== expected) throw new ApiError('The X post text does not match this order.');
  if (index && !post.data?.referenced_tweets?.some((ref: { type: string; id: string }) => ref.type === 'replied_to' && ref.id === value.published_ids[index - 1]))
    throw new ApiError('This post is not a reply to the previous thread post.');
  const ids = [...value.published_ids, postId];
  const { error } = await db().from('tweet_orders').update({ published_ids: ids, publish_attempt: null, status: ids.length === value.tweets.length ? 'published' : 'approved',
    published_url: `https://x.com/${value.target_username || 'lumenless'}/status/${ids[0]}`, publish_error: null, updated_at: new Date().toISOString() }).eq('id', value.id).eq('status', 'publish_uncertain');
  if (error) throw new ApiError('Could not reconcile the publication.', 503);
}
