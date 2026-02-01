export type LogLevel = "debug" | "info" | "warn" | "error";
export type LoggerFn = (level: LogLevel, message: string) => void;
export declare function setLogger(logger: LoggerFn): void;
export declare const logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};
