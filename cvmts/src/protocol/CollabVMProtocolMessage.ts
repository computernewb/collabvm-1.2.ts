import CollabVMRectMessage from "./CollabVMRectMessage.js";

export interface CollabVMProtocolMessage {
    type: CollabVMProtocolMessageType;
    rect?: CollabVMRectMessage | undefined;
}

export enum CollabVMProtocolMessageType {
    // JPEG Dirty Rectangle
    rect = 0,
}