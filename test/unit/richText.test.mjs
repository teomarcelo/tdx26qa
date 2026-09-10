/**
 * Unit tests for the Slack-style rich-text renderer.
 *
 * Run with `npm run test:unit` (no emulator needed).
 *
 * formatRichMessage output is injected with dangerouslySetInnerHTML, so the
 * escaping behaviour here is load-bearing, not cosmetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRichMessage, esc } from '../../src/lib/richText.js';

test('escapes HTML in plain text', () => {
  const out = formatRichMessage('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'), 'raw script tag must not survive');
  assert.ok(out.includes('&lt;script&gt;'));
});

test('an image tag in user text cannot execute a handler', () => {
  const out = formatRichMessage('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'), 'raw img tag must not survive');
  assert.ok(out.includes('&lt;img'));
});

test('bare URLs with underscores stay intact', () => {
  // Regression: emphasis used to run before linkify, turning the middle of this
  // URL into <em> and truncating the link.
  const url = 'https://example.com/a_b_c_d';
  const out = formatRichMessage(url);
  assert.ok(!out.includes('<em>'), `no emphasis inside a URL: ${out}`);
  assert.ok(out.includes(`href="${url}"`), `href should be the whole URL: ${out}`);
});

test('bare URLs with asterisks stay intact', () => {
  const url = 'https://example.com/a*b*c';
  const out = formatRichMessage(url);
  assert.ok(!out.includes('<strong>'), `no bold inside a URL: ${out}`);
  assert.ok(out.includes(`href="${url}"`));
});

test('trailing sentence punctuation is not swallowed by the link', () => {
  const out = formatRichMessage('see https://example.com/docs.');
  assert.ok(out.includes('href="https://example.com/docs"'), out);
  assert.ok(out.trimEnd().endsWith('.'), `the period stays as prose: ${out}`);
});

test('a URL in parentheses keeps balanced parens but drops the closer', () => {
  const wrapped = formatRichMessage('(see https://example.com/x)');
  assert.ok(wrapped.includes('href="https://example.com/x"'), wrapped);

  const balanced = 'https://en.wikipedia.org/wiki/Foo_(bar)';
  const out = formatRichMessage(balanced);
  assert.ok(out.includes(`href="${balanced}"`), `balanced parens survive: ${out}`);
});

test('emphasis still works in ordinary prose', () => {
  assert.ok(formatRichMessage('an *important* point').includes('<strong>important</strong>'));
  assert.ok(formatRichMessage('an _italic_ word').includes('<em>italic</em>'));
  assert.ok(formatRichMessage('a ~struck~ word').includes('<del>struck</del>'));
});

test('a URL wrapped in emphasis renders as an emphasised link', () => {
  const out = formatRichMessage('*https://example.com/x*');
  assert.ok(out.includes('<strong>'), out);
  assert.ok(out.includes('href="https://example.com/x"'), out);
});

test('markdown links escape both label and href', () => {
  const out = formatRichMessage('[click "me"](https://example.com/a_b)');
  assert.ok(out.includes('href="https://example.com/a_b"'), out);
  assert.ok(out.includes('&quot;me&quot;'), out);
});

test('javascript: URLs are never linkified', () => {
  const out = formatRichMessage('javascript:alert(1) and [x](javascript:alert(1))');
  assert.ok(!out.includes('href="javascript:'), out);
});

test('a quote in a URL cannot break out of the href attribute', () => {
  const out = formatRichMessage('https://example.com/"onmouseover="alert(1)');
  // The quote must be entity-encoded, leaving the attribute intact.
  assert.ok(!/href="[^"]*"\s*onmouseover/i.test(out), out);
});

test('code blocks and inline code keep their content escaped', () => {
  const fenced = formatRichMessage('```\n<b>hi</b>\n```');
  assert.ok(fenced.includes('&lt;b&gt;hi&lt;/b&gt;'), fenced);
  assert.ok(!fenced.includes('<b>hi</b>'));

  const inline = formatRichMessage('use `<b>tags</b>` here');
  assert.ok(inline.includes('&lt;b&gt;tags&lt;/b&gt;'), inline);
});

test('placeholder sentinels in user input cannot reference a chunk', () => {
  // \uFFF0R0\uFFF1 is the internal marker format; typing it must be inert.
  const out = formatRichMessage('`real code` and \uFFF0R0\uFFF1');
  assert.ok(out.includes('real code'), out);
  // The literal marker must not have been expanded into a second copy.
  assert.equal(out.split('rich-code-line-wrap').length - 1, 1, out);
});

test('esc leaves already-safe text unchanged', () => {
  assert.equal(esc('plain text 123'), 'plain text 123');
  assert.equal(esc('a & b'), 'a &amp; b');
});

// ── Emphasis must not eat Salesforce API names (COR-03) ──────────────────────
// This is a Salesforce training tool: Some_Field__c is the most common technical
// token in its domain, and underscore emphasis used to shred it.

test('a Salesforce API name survives verbatim', () => {
  assert.equal(formatRichMessage('Custom_Field__c'), 'Custom_Field__c');
});

test('two API names in one sentence both survive', () => {
  const src = 'Use Account.My_Field__c and Contact.Other_Field__c';
  assert.equal(formatRichMessage(src), src);
});

test('a SOQL query with an API name is untouched', () => {
  const src = 'SELECT Id, Name FROM Account WHERE Owner_Id__c = :x';
  assert.equal(formatRichMessage(src), src);
});

test('a mid-word underscore is preserved verbatim', () => {
  assert.equal(formatRichMessage('snake_case_name'), 'snake_case_name');
  assert.equal(formatRichMessage('x_y'), 'x_y');
});

test('arithmetic asterisks are not read as bold', () => {
  const src = '5 * 3 and 2 * 4 equals fifteen and eight';
  const out = formatRichMessage(src);
  assert.ok(!out.includes('<strong>'), out);
  assert.equal(out, src);
});

test('bold does not cross a line break', () => {
  const src = 'line one *not bold\nline two* still';
  const out = formatRichMessage(src);
  assert.ok(!out.includes('<strong>'), out);
  assert.equal(out, src);
});

test('bold does not cross a blank line', () => {
  const src = 'para one *open\n\npara two* close';
  const out = formatRichMessage(src);
  assert.ok(!out.includes('<strong>'), out);
});

test('genuine emphasis still renders after the boundary rules', () => {
  assert.ok(formatRichMessage('an _italic_ word').includes('<em>italic</em>'));
  assert.ok(formatRichMessage('_leading and trailing_').includes('<em>leading and trailing</em>'));
  assert.ok(formatRichMessage('(_parenthesised_)').includes('<em>parenthesised</em>'));
  assert.ok(formatRichMessage('an *important* point').includes('<strong>important</strong>'));
  assert.ok(formatRichMessage('a ~struck~ word').includes('<del>struck</del>'));
});

test('**bold** works and leaves no stray asterisk', () => {
  const out = formatRichMessage('**bold**');
  assert.equal(out, '<strong>bold</strong>');
  assert.ok(formatRichMessage('say **this** now').includes('<strong>this</strong>'));
});

test('emphasis markers inside inline code are left alone', () => {
  const out = formatRichMessage('`Custom_Field__c` and `5 * 3`');
  assert.ok(!out.includes('<em>'), out);
  assert.ok(!out.includes('<strong>'), out);
  assert.ok(out.includes('Custom_Field__c'), out);
  assert.ok(out.includes('5 * 3'), out);
});

test('emphasis markers inside a fenced block are left alone', () => {
  const out = formatRichMessage('```\nMy_Field__c = a * b;\n```');
  assert.ok(!out.includes('<em>'), out);
  assert.ok(!out.includes('<strong>'), out);
  assert.ok(out.includes('My_Field__c = a * b;'), out);
});
