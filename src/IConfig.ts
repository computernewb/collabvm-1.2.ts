export default interface IConfig {
    http : {
        host : string;
        port : number;
        proxying : boolean;
        proxyAllowedIps : string[];
        origin : boolean;
        originAllowedDomains : string[];
        maxConnections: number;
    };
    auth : {
        enabled : boolean;
        apiEndpoint : string;
        secretKey : string;
        guestPermissions : {
            chat : boolean;
            turn : boolean;
        }
    }
    vm : {
        qemuArgs : string;
        vncPort : number;
        snapshots : boolean;
        qmpHost : string | null;
        qmpPort : number | null;
        qmpSockDir : string | null;
    };
    collabvm : {
        node : string;
        displayname : string;
        motd : string;
        bancmd : string | string[];
        moderatorEnabled : boolean;
        usernameblacklist : string[];
        maxChatLength : number;
        maxChatHistoryLength : number;
        turnlimit : {
            enabled: boolean,
            maximum: number;
        };
        automute : {
            enabled: boolean;
            seconds: number;
            messages: number;
        };
        tempMuteTime : number;
        turnTime : number;
        voteTime : number;
        voteCooldown: number;
        adminpass : string;
        modpass : string;
        turnwhitelist : boolean;
        turnpass : string;
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