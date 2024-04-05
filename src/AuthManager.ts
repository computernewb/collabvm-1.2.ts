import { Rank, User } from "./User.js";
import log from "./log.js";

export default class AuthManager {
    apiEndpoint : string;
    secretKey : string;
    constructor(apiEndpoint : string, secretKey : string) {
        this.apiEndpoint = apiEndpoint;
        this.secretKey = secretKey;
    }

    Authenticate(token : string, user : User) {
        return new Promise<JoinResponse>(async res => {
            var response = await fetch(this.apiEndpoint + "/api/v1/join", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    secretKey: this.secretKey,
                    sessionToken: token,
                    ip: user.IP.address
                })
            });
            var json = await response.json() as JoinResponse;
            if (!json.success) {
                log("FATAL", `Failed to query auth server: ${json.error}`);
                process.exit(1);
            }
            res(json);
        });
    }
}

interface JoinResponse {
    success : boolean;
    clientSuccess : boolean;
    error : string | undefined;
    username : string | undefined;
    rank : Rank;
}