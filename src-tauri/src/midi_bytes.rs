#[derive(Debug, PartialEq, Eq)]
pub enum MidiNote {
    On(u8),
    Off(u8),
}

/// 从一段 MIDI 字节里取出 Note On/Off。力度 0 的 Note On 算松开。
/// `running` 跨多次回调保留。SysEx、系统通用消息和实时字节不产生音符。
pub fn feed(bytes: &[u8], running: &mut Option<u8>) -> Vec<MidiNote> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte >= 0xF8 {
            i += 1;
            continue;
        }
        if byte == 0xF0 {
            *running = None;
            i += 1;
            while i < bytes.len() && bytes[i] != 0xF7 {
                i += 1;
            }
            if i < bytes.len() {
                i += 1;
            }
            continue;
        }

        let status = if byte & 0x80 != 0 {
            i += 1;
            if byte >= 0xF0 {
                let extra = match byte {
                    0xF1 | 0xF3 => 1,
                    0xF2 => 2,
                    _ => 0,
                };
                *running = None;
                let mut left = extra;
                while left > 0 && i < bytes.len() {
                    if bytes[i] < 0xF8 {
                        left -= 1;
                    }
                    i += 1;
                }
                continue;
            }
            *running = Some(byte);
            byte
        } else if let Some(status) = *running {
            status
        } else {
            i += 1;
            continue;
        };

        let needed = match status & 0xF0 {
            0xC0 | 0xD0 => 1,
            _ => 2,
        };
        let mut data = [0u8; 2];
        let mut got = 0;
        let mut interrupted = false;
        while got < needed && i < bytes.len() {
            let data_byte = bytes[i];
            if data_byte >= 0xF8 {
                i += 1;
                continue;
            }
            if data_byte & 0x80 != 0 {
                interrupted = true;
                break;
            }
            data[got] = data_byte;
            got += 1;
            i += 1;
        }
        if interrupted {
            continue;
        }
        if got < needed {
            break;
        }
        let note = data[0];
        if note > 127 {
            continue;
        }
        match status & 0xF0 {
            0x90 if data[1] > 0 => out.push(MidiNote::On(note)),
            0x90 | 0x80 => out.push(MidiNote::Off(note)),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn once(bytes: &[u8]) -> Vec<MidiNote> {
        let mut running = None;
        feed(bytes, &mut running)
    }

    #[test]
    fn note_on_and_off() {
        assert_eq!(once(&[0x90, 60, 100]), vec![MidiNote::On(60)]);
        assert_eq!(once(&[0x80, 60, 0]), vec![MidiNote::Off(60)]);
        assert_eq!(once(&[0x90, 60, 0]), vec![MidiNote::Off(60)]);
        assert_eq!(once(&[0x91, 62, 40]), vec![MidiNote::On(62)]);
    }

    #[test]
    fn running_status_and_realtime() {
        assert_eq!(
            once(&[0x90, 60, 100, 62, 40]),
            vec![MidiNote::On(60), MidiNote::On(62)]
        );
        assert_eq!(once(&[0x90, 60, 0xF8, 100]), vec![MidiNote::On(60)]);
    }

    #[test]
    fn skips_sysex() {
        assert_eq!(
            once(&[0xF0, 0x01, 0x02, 0xF7, 0x90, 60, 40]),
            vec![MidiNote::On(60)]
        );
    }

    #[test]
    fn running_status_survives_calls() {
        let mut running = None;
        assert_eq!(feed(&[0x90, 60, 10], &mut running), vec![MidiNote::On(60)]);
        assert_eq!(feed(&[64, 20], &mut running), vec![MidiNote::On(64)]);
    }
}
