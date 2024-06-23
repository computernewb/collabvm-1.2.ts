import { StringLike } from './StringLike';

function isalpha(char: number) {
	return RegExp(/^\p{L}/, 'u').test(String.fromCharCode(char));
}

/// A simple function for formatting strings in a more expressive manner.
/// While JavaScript *does* have string interpolation, it's not a total replacement
/// for just formatting strings, and a method like this is better for data independent formatting.
///
/// ## Example usage
///
/// ```typescript
/// let hello = Format("Hello, {0}!", "World");
/// ```
export function Format(pattern: string, ...args: Array<StringLike>) {
	let argumentsAsStrings: Array<string> = [...args].map((el) => {
		// This catches cases where the thing already is a string
		if (typeof el == 'string') return el as string;
		return el.toString();
	});

	let pat = pattern;

	// Handle pattern ("{0} {1} {2} {3} {4} {5}") syntax if found
	for (let i = 0; i < pat.length; ++i) {
		if (pat[i] == '{') {
			let replacementStart = i;
			let foundSpecifierEnd = false;

			// Make sure the specifier is not cut off (the last character of the string)
			if (i + 3 > pat.length) {
				throw new Error(`Error in format pattern "${pat}": Cutoff/invalid format specifier`);
			}

			// Try and find the specifier end ('}').
			// Whitespace and a '{' are considered errors.
			for (let j = i + 1; j < pat.length; ++j) {
				switch (pat[j]) {
					case '}':
						foundSpecifierEnd = true;
						i = j;
						break;

					case '{':
						throw new Error(`Error in format pattern "${pat}": Cannot start a format specifier in an existing replacement`);
					case ' ':
						throw new Error(`Error in format pattern "${pat}": Whitespace inside format specifier`);

					case '-':
						throw new Error(`Error in format pattern "${pat}": Malformed format specifier`);

					default:
						if (isalpha(pat.charCodeAt(j))) throw new Error(`Error in format pattern "${pat}": Malformed format specifier`);
						break;
				}

				if (foundSpecifierEnd) break;
			}

			if (!foundSpecifierEnd) throw new Error(`Error in format pattern "${pat}": No terminating "}" character found`);

			// Get the beginning and trailer
			let beginning = pat.substring(0, replacementStart);
			let trailer = pat.substring(replacementStart + 3);

			let argumentIndex = parseInt(pat.substring(replacementStart + 1, i));
			if (Number.isNaN(argumentIndex) || argumentIndex > argumentsAsStrings.length) throw new Error(`Error in format pattern "${pat}": Argument index out of bounds`);

			// This is seriously the only decent way to do this in javascript
			// thanks brendan eich (replace this thanking with more choice words in your head)
			pat = beginning + argumentsAsStrings[argumentIndex] + trailer;
		}
	}

	return pat;
}
