// TODO: `Object` has a toString(), but we should probably gate that off
/// Interface for things that can be turned into strings
export interface ToStringable {
	toString(): string;
}

/// A type for strings, or things that can (in a valid manner) be turned into strings
export type StringLike = string | ToStringable;
