export class IPData {
    tempMuteExpireTimeout? : NodeJS.Timeout;
    muted: Boolean;
    vote: boolean | null;
    address: string;

    constructor(address: string) {
        this.address = address;
        this.muted = false;
        this.vote = null;
    }
}