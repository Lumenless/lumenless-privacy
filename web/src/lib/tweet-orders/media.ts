import { MEDIA_BUCKET, TweetOrder } from './model';
import { ApiError, db } from './server';

export async function validateMedia(value: TweetOrder) {
  for (const tweet of value.tweets) for (const file of tweet.media) {
    const folder = file.path.slice(0, file.path.lastIndexOf('/'));
    const filename = file.path.slice(file.path.lastIndexOf('/') + 1);
    const { data, error } = await db().storage.from(MEDIA_BUCKET).list(folder, { search: filename, limit: 1 });
    const uploaded = data?.find(item => item.name === filename);
    if (error || !uploaded || Number(uploaded.metadata?.size) !== file.size || uploaded.metadata?.mimetype !== file.type)
      throw new ApiError(`Upload ${file.name} before payment. Its size and type must match the selected file.`);
    const { data: signed } = await db().storage.from(MEDIA_BUCKET).createSignedUrl(file.path, 60);
    if (!signed) throw new ApiError('Could not verify uploaded media.', 503);
    const response = await fetch(signed.signedUrl, { headers: { Range: 'bytes=0-15' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok || response.status !== 206) throw new ApiError('Media validation is unavailable.', 503);
    const bytes = Buffer.from(await response.arrayBuffer());
    const valid = file.type === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : file.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : file.type === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      : bytes.toString('ascii', 4, 8) === 'ftyp';
    if (!valid) throw new ApiError(`${file.name} is not a valid ${file.type} file.`);
  }
}
