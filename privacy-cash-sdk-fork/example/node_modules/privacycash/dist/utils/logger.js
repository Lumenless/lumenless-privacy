const defaultLogger = (level, message) => {
    const prefix = `[${level.toUpperCase()}]`;
    console.log(prefix, message);
};
let userLogger = defaultLogger;
export function setLogger(logger) {
    userLogger = logger;
}
function argToStr(args) {
    return args.map(arg => {
        if (typeof arg === "object" && arg !== null) {
            try {
                return JSON.stringify(arg);
            }
            catch {
                return String(arg);
            }
        }
        return String(arg);
    }).join(" ");
}
export const logger = {
    debug: (...args) => {
        userLogger('debug', argToStr(args));
    },
    info: (...args) => {
        userLogger('info', argToStr(args));
    },
    warn: (...args) => {
        userLogger('warn', argToStr(args));
    },
    error: (...args) => {
        userLogger('error', argToStr(args));
    },
};
