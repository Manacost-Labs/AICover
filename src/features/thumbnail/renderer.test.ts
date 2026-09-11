import { describe, expect, it } from 'vitest';
import { splitHeadline } from './renderer';

describe('splitHeadline', () => {
  it('trims empty lines and limits the cover to five lines', () => {
    expect(splitHeadline('  Новая  \n\n имба \n раз \n два \n три \n четыре')).toEqual([
      'Новая', 'имба', 'раз', 'два', 'три',
    ]);
  });
});
