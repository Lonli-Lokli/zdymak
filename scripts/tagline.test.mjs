// The tagline breaks between its sentences in every script, not only after a Latin full stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTagline } from '../src/graphic.mjs';

test('a Latin tagline splits after its first sentence', () => {
  assert.deepEqual(splitTagline('Learn anything. Remember it for good.'), ['Learn anything.', 'Remember it for good.']);
});

test('Japanese and Chinese split after the ideographic full stop, with or without a space', () => {
  assert.deepEqual(splitTagline('何でも学べます。ずっと覚えていられます。'), ['何でも学べます。', 'ずっと覚えていられます。']);
  assert.deepEqual(splitTagline('什么都能学。 学会的，一直记得。'), ['什么都能学。', '学会的，一直记得。']);
});

test('Hindi, Bengali and Urdu split after their own full stops', () => {
  assert.deepEqual(splitTagline('कुछ भी सीखें। हमेशा के लिए याद रखें।'), ['कुछ भी सीखें।', 'हमेशा के लिए याद रखें।']);
  assert.deepEqual(splitTagline('جو چاہیں سیکھیں۔ اسے ہمیشہ یاد رکھیں۔'), ['جو چاہیں سیکھیں۔', 'اسے ہمیشہ یاد رکھیں۔']);
});

test('a decimal point or a final stop alone does not split', () => {
  assert.deepEqual(splitTagline('Version 1.5 is here'), ['Version 1.5 is here', '']);
  assert.deepEqual(splitTagline('何でも学べます。'), ['何でも学べます。', '']);
});
