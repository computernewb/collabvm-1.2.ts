import { Canvas } from "canvas";
import EventEmitter from "events";

export default abstract class VM extends EventEmitter {
    public abstract getSize() : {height:number;width:number;};
    public abstract get framebuffer() : Canvas;
    public abstract pointerEvent(x : number, y : number, mask : number) : void;
    public abstract acceptingInput() : boolean;
    public abstract keyEvent(keysym : number, down : boolean) : void;
    public abstract Restore() : void;
    public abstract Reboot() : Promise<void>;
}