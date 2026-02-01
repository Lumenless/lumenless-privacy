import { RELAYER_API_URL } from "./utils/constants.js";
let config;
export async function getConfig(key) {
    if (!config) {
        const res = await fetch(RELAYER_API_URL + '/config');
        config = await res.json();
    }
    if (typeof config[key] == 'undefined') {
        throw new Error(`can not get ${key} from ${RELAYER_API_URL}/config`);
    }
    return config[key];
}
