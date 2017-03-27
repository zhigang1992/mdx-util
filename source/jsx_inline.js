// Process JSX tags.
// Based on https://github.com/osnr/markdown-it-jsx/blob/8182cd42db551b03f0f73653a4fbee0948807dd4/lib/jsx_inline.js

import parser from './jsxParser'
import { transform } from 'babel-core'

const {
  JSX_INLINE_OPEN_TAG_PARSER,
  JSX_INLINE_CLOSE_TAG_PARSER,
  JSX_INLINE_SELF_CLOSE_TAG_PARSER
} = parser;


function transformJSX(code) {
  try {
    return transform(code, {
      babelrc: false,
      plugins: [
        'babel-plugin-syntax-jsx',
        ['babel-plugin-transform-react-jsx', { pragma: 'createElement' }]]
      }).code.replace(/;$/, '')
  }
  catch (e) {
    return
  }
}


// Iterate through a JSX tag's content until the closing tag is found, making
// sure to skip nested JSX and to not match closing tags in code blocks.
function parseJSXContent(state, start, type) {
  var text,
      result,
      max = state.posMax,
      prevPos,
      oldPos = state.pos;

  state.pos = start;

  while (state.pos < max) {
    text = state.src.slice(state.pos)
    result = JSX_INLINE_CLOSE_TAG_PARSER.parse(text)

    prevPos = state.pos;
    state.md.inline.skipToken(state);

    if (result.status && result.value.value === type && prevPos === state.pos - 1) {
      // restore old state
      state.pos = oldPos;
      return { contentEnd: prevPos, closeEnd: prevPos + result.value.end.offset }
    }
  }

  // restore old state
  state.pos = oldPos;
};


function isLetter(ch) {
  var lc = ch | 0x20; // to lower case
  return (lc >= 0x61/* a */) && (lc <= 0x7a/* z */);
}


module.exports = function jsx_inline(state, silent) {
  var result, max, token,
      pos = state.pos;

  // Check start
  max = state.posMax;
  var firstCh = state.src.charCodeAt(pos);
  if ((firstCh !== 0x3C/* < */ &&
       firstCh !== 0x7B/* { */) ||
      pos + 2 >= max) {
    return false;
  }

  // Quick fail on second char if < was first char
  var secondCh = state.src.charCodeAt(pos + 1);
  if (secondCh === 0x3C/* < */ &&
      (secondCh !== 0x21/* ! */ &&
       secondCh !== 0x3F/* ? */ &&
       secondCh !== 0x2F/* / */ &&
       !isLetter(secondCh))) {
    return false;
  }

  const text = state.src.slice(pos);

  result = JSX_INLINE_OPEN_TAG_PARSER.parse(text);

  if (!result.status) {
    return false;
  }

  const selfClosing =
    JSX_INLINE_SELF_CLOSE_TAG_PARSER.parse(text)

  if (selfClosing.status) {
    const content = state.src.slice(pos, pos + selfClosing.value.end.offset);
    const js = transformJSX(content)

    if (!js) {
      return false
    }

    if (!silent) {
      token         = state.push('jsx_inline', '', 0);
      token.content = js
    }

    state.pos += selfClosing.value.end.offset;
    return true;
  }

  const contentStart = state.pos + result.value.end.offset
  const contentObj = parseJSXContent(state, contentStart, result.value.value)
  if (!contentObj) { return false; }
  const { contentEnd, closeEnd } = contentObj

  const tag = state.src.slice(pos, contentStart).replace(/>$/, '/>')
  const js = transformJSX(tag)
  if (!js) { return false }

  const content = state.src.slice(contentStart, contentEnd).trim()

  if (!silent) {
    if (content.length === 0) {
      token         = state.push('jsx_inline', '', 0);
      token.content = js
    }
    else {
      state.pos = contentStart;
      state.posMax = contentEnd;

      token         = state.push('jsx_inline', '', 1);
      token.content = js.slice(0, js.length - 1)
      
      state.md.inline.tokenize(state);

      token         = state.push('jsx_inline', '', -1);
      token.content = ')'
    }
  }

  state.pos = closeEnd;
  state.posMax = max;
  return true;
};
