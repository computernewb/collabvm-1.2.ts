import IConfig from "./IConfig";
import axios from 'axios';
import querystring from 'node:querystring';

export default class hcaptcha {
    Config : IConfig;
    ValidIps : string[];
    constructor(config : IConfig) {
        this.Config = config;
        this.ValidIps = [];
    }
    checkIpValidated(ip : string) : boolean {
        return (this.ValidIps.indexOf(ip) !== -1);
    }
    validateToken(token : string, ip : string) : Promise<boolean> {
        return new Promise(async (res, rej) => {
            var response;
            try {
                response = await axios.post("https://hcaptcha.com/siteverify", querystring.encode({
                    "secret": this.Config.hcaptcha.secret,
                    "response": token,
                    "remoteip": ip
                }));
            } catch (e) {rej(e); return;}
            if (response.data.success === true) {
                this.ValidIps.push(ip);
            }
            res(response.data.success);
        })
    }
}