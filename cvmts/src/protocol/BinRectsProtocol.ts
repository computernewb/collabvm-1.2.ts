import * as msgpack from 'msgpackr';
import { CollabVMProtocolMessage, CollabVMProtocolMessageType } from '@cvmts/collab-vm-1.2-binary-protocol';
import { GuacamoleProtocol } from './GuacamoleProtocol.js';
import { ScreenRect } from './Protocol';

export class BinRectsProtocol extends GuacamoleProtocol {
  sendScreenUpdate(rect: ScreenRect): void {
    let bmsg: CollabVMProtocolMessage = {
      type: CollabVMProtocolMessageType.rect,
      rect: rect
    };
    this.user?.socket.sendBinary(msgpack.encode(bmsg));
  }

  sendAudioOpus(opusPacket: Buffer): void {
    if (!this.user?.socket.isOpen()) return;

    try {
      let bmsg: CollabVMProtocolMessage = {
        type: CollabVMProtocolMessageType.audioOpus,
        opusPacket: opusPacket // Buffer is serialized as binary by msgpackr
      };
      const encoded = msgpack.encode(bmsg);
      this.user.socket.sendBinary(encoded);
    } catch (err) {
      console.error('[Server] Error sending audioOpus:', err);
    }
  }
}