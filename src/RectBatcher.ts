import { Canvas, createCanvas, createImageData } from "canvas";

export default async function BatchRects(fb : Canvas, rects : {height:number,width:number,x:number,y:number,data:Buffer}[]) : Promise<{x:number,y:number,data:Canvas}> {
    var mergedX = fb.width;
    var mergedY = fb.height;
    var mergedHeight = 0;
    var mergedWidth = 0;
    rects.forEach((r) => {
        if (r.x < mergedX) mergedX = r.x;
        if (r.y < mergedY) mergedY = r.y;
    });
    rects.forEach(r => {
        if (((r.height + r.y) - mergedY) > mergedHeight) mergedHeight = (r.height + r.y) - mergedY;
        if (((r.width + r.x) - mergedX) > mergedWidth) mergedWidth = (r.width + r.x) - mergedX; 
    });
    var rect = createCanvas(mergedWidth, mergedHeight);
    var ctx = rect.getContext("2d");
    ctx.drawImage(fb, mergedX, mergedY, mergedWidth, mergedHeight, 0, 0, mergedWidth, mergedHeight);
    for (const r of rects) {
        var id = createImageData(Uint8ClampedArray.from(r.data), r.width, r.height);
        ctx.putImageData(id, r.x - mergedX, r.y - mergedY);
    }
    return {
        data: rect,
        x: mergedX,
        y: mergedY,
    }
}