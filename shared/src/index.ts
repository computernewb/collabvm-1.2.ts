// public modules
export * from './StringLike.js';
export * from './Logger.js';
export * from './format.js';

export function Clamp(input: number, min: number, max: number) {
	return Math.min(Math.max(input, min), max);
}

export async function Sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Size = {
	width: number;
	height: number;
};

export type Rect = {
	x: number,
	y: number,
	width: number,
	height: number
};