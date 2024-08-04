use std::fmt;

// type of a guac message
pub type Elements = Vec<String>;

// FIXME: thiserror, please.

/// Errors during decoding
#[derive(Debug, Clone)]
pub enum DecodeError {
    /// Invalid guacamole instruction format
    InvalidFormat,

    /// Instruction is too long for the current decode policy.
    InstructionTooLong,

    /// Element is too long for the current decode policy.
    ElementTooLong,

    /// Invalid element size.
    ElementSizeInvalid,
}

pub type DecodeResult<T> = std::result::Result<T, DecodeError>;

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFormat => write!(f, "Invalid Guacamole instruction while decoding"),
            Self::InstructionTooLong => write!(f, "Instruction too long for current decode policy"),
            Self::ElementTooLong => write!(f, "Element too long for current decode policy"),
            Self::ElementSizeInvalid => write!(f, "Element size is invalid"),
        }
    }
}

// this decode policy abstraction would in theory be useful,
// but idk how to do this kind of thing in rust very well

pub struct StaticDecodePolicy<const INST_SIZE: usize, const ELEM_SIZE: usize>();

impl<const INST_SIZE: usize, const ELEM_SIZE: usize> StaticDecodePolicy<INST_SIZE, ELEM_SIZE> {
    fn max_instruction_size(&self) -> usize {
        INST_SIZE
    }

    fn max_element_size(&self) -> usize {
        ELEM_SIZE
    }
}

/// The default decode policy.
pub type DefaultDecodePolicy = StaticDecodePolicy<12288, 4096>;

/// Encodes elements into a Guacamole instruction
pub fn encode_instruction(elements: &Elements) -> String {
    let mut str = String::new();

    for elem in elements.iter() {
        str.push_str(&format!("{}.{},", elem.len(), elem));
    }

    // hacky, but whatever
    str.pop();
    str.push(';');

    str
}

/// Decodes a Guacamole instruction to individual elements
pub fn decode_instruction(element_string: &String) -> DecodeResult<Elements> {
    let policy = DefaultDecodePolicy {};

    let mut vec: Elements = Vec::new();
    let mut current_position: usize = 0;

    // Instruction is too long. Don't even bother
    if policy.max_instruction_size() < element_string.len() {
        return Err(DecodeError::InstructionTooLong);
    }

    let chars = element_string.chars().collect::<Vec<_>>();

    loop {
        let mut element_size: usize = 0;

        // Scan the integer value in by hand. This is mostly because
        // I'm stupid, and the Rust integer parsing routines (seemingly)
        // require a substring (or a slice, but, if you can generate a slice,
        // you can also just scan the value in by hand.)
        //
        // We bound this anyways and do quite the checks, so even though it's not great,
        // it should be generally fine (TM).
        loop {
            let c = chars[current_position];

            if c >= '0' && c <= '9' {
                element_size = element_size * 10 + (c as usize) - ('0' as usize);
            } else {
                if c == '.' {
                    break;
                }

                return Err(DecodeError::InvalidFormat);
            }
            current_position += 1;
        }

        // Eat the '.' seperating the size and the element data;
        // our integer scanning ensures we only get here in the case that this is actually the '.'
        // character.
        current_position += 1;

        // Make sure the element size doesn't overflow the decode policy
        // or the size of the whole instruction.

        if element_size >= policy.max_element_size() {
            return Err(DecodeError::ElementTooLong);
        }

        if element_size >= element_string.len() {
            return Err(DecodeError::ElementSizeInvalid);
        }

        // cutoff elements or something
        if current_position + element_size > chars.len() - 1 {
            //println!("? {current_position} a {}", chars.len());
            return Err(DecodeError::InvalidFormat);
        }

        let element = chars
            .iter()
            .skip(current_position)
            .take(element_size)
            .collect::<String>();

        current_position += element_size;

        vec.push(element);

        // make sure seperator is proper
        match chars[current_position] {
            ',' => {}
            ';' => break,
            _ => return Err(DecodeError::InvalidFormat),
        }

        // eat the ','
        current_position += 1;
    }

    Ok(vec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_basic() {
        let test = String::from("7.connect,3.vm1;");
        let res = decode_instruction(&test);

        assert!(res.is_ok());
        assert_eq!(res.unwrap(), vec!["connect", "vm1"]);
    }

    #[test]
    fn decode_errors() {
        let test = String::from("700.connect,3.vm1;");
        let res = decode_instruction(&test);

        eprintln!("Error for: {}", res.clone().unwrap_err());

        assert!(res.is_err())
    }

    // generally just test that the codec even works
    // (we can decode a instruction we created)
    #[test]
    fn general_codec_works() {
        let vec = vec![String::from("connect"), String::from("vm1")];
        let test = encode_instruction(&vec);

        assert_eq!(test, "7.connect,3.vm1;");

        let res = decode_instruction(&test);

        assert!(res.is_ok());
        assert_eq!(res.unwrap(), vec);
    }
}
