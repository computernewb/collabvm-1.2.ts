export default function log(loglevel : string, message : string) {
    console[(loglevel === "ERROR" || loglevel === "FATAL") ? "error" : "log"](`[${new Date().toLocaleString()}] [${loglevel}] ${message}`);
}