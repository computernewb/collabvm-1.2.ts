export default interface IConfig {
    http : {
        host : string;
        port : number;
        proxying : boolean;
        proxyAllowedIps : string[];
    };
    hcaptcha : {
        enabled : boolean;
        sitekey : string;
        secret : string;
        whitelist : string[];
    };
    vm : {
        qemuArgs : string;
        vncPort : number;
        snapshots : boolean;
        qmpSockDir : string;
    };
    collabvm : {
        node : string;
        displayname : string;
        motd : string;
        bancmd : string;
        moderatorEnabled : boolean;
        usernameblacklist : string[];
        maxChatLength : number;
        automute : {
            enabled: boolean;
            seconds: number;
            messages: number;
        };
        tempMuteTime : number;
        turnTime : number;
        voteTime : number;
        adminpass : string;
        modpass : string;
        moderatorPermissions : Permissions;
    };
};

export interface Permissions {
    restore : boolean;
    reboot : boolean;
    ban : boolean;
    forcevote : boolean;
    mute : boolean;
    kick : boolean;
    bypassturn : boolean;
    rename : boolean;
    grabip : boolean;
    xss : boolean;
}