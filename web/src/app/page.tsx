import type { Metadata } from 'next';
import Checkout from './Checkout';
const title = 'Lumenless — Tell your story on @lumenless';
const description = 'Introduce yourself, launch your project, or share your story with the Lumenless audience on X. Submit a paid tweet or thread for review.';
export const metadata: Metadata = { title, description, openGraph: { title, description }, twitter: { title, description } };
export default function Home() { return <Checkout />; }
