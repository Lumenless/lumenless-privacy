declare module 'twitter-text/dist/parseTweet' {
  export default function parseTweet(text: string): { weightedLength: number; valid: boolean };
}
