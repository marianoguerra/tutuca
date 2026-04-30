// Vendored from htmlparser2 v12.0.0 (https://github.com/fb55/htmlparser2),
// MIT licensed (Felix Boehm <me@feedic.com> and contributors).
//
// Stripped of entity-decoding paths: we always run with `decodeEntities: false`,
// so the entire `entities/decode` import (≈30 KB minified including the
// Uint16Array decode trie) is dead weight. Removing it shrinks the dev bundle.
//
// Re-sync procedure: pull the latest `dist/Tokenizer.js`, then re-apply the
// deletions described in the trim list (entity decoder, InEntity state,
// startEntity/stateInEntity/emitCodePoint, the four `decodeEntities && Amp`
// branches, and the `!decodeEntities && fastForwardTo` short-circuits).
//
// Test parity is enforced by `test/htmllinter.test.js`, which runs every case
// against both this vendored copy and the real htmlparser2 Tokenizer.

const CharCodes = {
  Tab: 9,
  NewLine: 10,
  FormFeed: 12,
  CarriageReturn: 13,
  Space: 32,
  ExclamationMark: 33,
  Number: 35,
  SingleQuote: 39,
  DoubleQuote: 34,
  Dash: 45,
  Slash: 47,
  Zero: 48,
  Nine: 57,
  Semi: 59,
  Lt: 60,
  Eq: 61,
  Gt: 62,
  Questionmark: 63,
  UpperA: 65,
  LowerA: 97,
  UpperF: 70,
  LowerF: 102,
  UpperZ: 90,
  LowerZ: 122,
  LowerX: 120,
  OpeningSquareBracket: 91,
};

const State = {
  Text: 1,
  BeforeTagName: 2,
  InTagName: 3,
  InSelfClosingTag: 4,
  BeforeClosingTagName: 5,
  InClosingTagName: 6,
  AfterClosingTagName: 7,
  // Attributes
  BeforeAttributeName: 8,
  InAttributeName: 9,
  AfterAttributeName: 10,
  BeforeAttributeValue: 11,
  InAttributeValueDq: 12,
  InAttributeValueSq: 13,
  InAttributeValueNq: 14,
  // Declarations
  BeforeDeclaration: 15,
  InDeclaration: 16,
  // Processing instructions
  InProcessingInstruction: 17,
  // Comments & CDATA
  BeforeComment: 18,
  CDATASequence: 19,
  DeclarationSequence: 20,
  InSpecialComment: 21,
  InCommentLike: 22,
  // Special tags
  SpecialStartSequence: 23,
  InSpecialTag: 24,
  InPlainText: 25,
};

function isWhitespace(c) {
  return (
    c === CharCodes.Space ||
    c === CharCodes.NewLine ||
    c === CharCodes.Tab ||
    c === CharCodes.FormFeed ||
    c === CharCodes.CarriageReturn
  );
}

function isEndOfTagSection(c) {
  return c === CharCodes.Slash || c === CharCodes.Gt || isWhitespace(c);
}

function isASCIIAlpha(c) {
  return (
    (c >= CharCodes.LowerA && c <= CharCodes.LowerZ) ||
    (c >= CharCodes.UpperA && c <= CharCodes.UpperZ)
  );
}

export const QuoteType = {
  NoValue: 0,
  Unquoted: 1,
  Single: 2,
  Double: 3,
};

const Sequences = {
  Empty: new Uint8Array(0),
  Cdata: new Uint8Array([0x43, 0x44, 0x41, 0x54, 0x41, 0x5b]), // CDATA[
  CdataEnd: new Uint8Array([0x5d, 0x5d, 0x3e]), // ]]>
  CommentEnd: new Uint8Array([0x2d, 0x2d, 0x21, 0x3e]), // `--!>`
  Doctype: new Uint8Array([0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65]), // `doctype`
  IframeEnd: new Uint8Array([0x3c, 0x2f, 0x69, 0x66, 0x72, 0x61, 0x6d, 0x65]), // `</iframe`
  NoembedEnd: new Uint8Array([0x3c, 0x2f, 0x6e, 0x6f, 0x65, 0x6d, 0x62, 0x65, 0x64]), // `</noembed`
  NoframesEnd: new Uint8Array([0x3c, 0x2f, 0x6e, 0x6f, 0x66, 0x72, 0x61, 0x6d, 0x65, 0x73]), // `</noframes`
  Plaintext: new Uint8Array([0x3c, 0x2f, 0x70, 0x6c, 0x61, 0x69, 0x6e, 0x74, 0x65, 0x78, 0x74]), // `</plaintext`
  ScriptEnd: new Uint8Array([0x3c, 0x2f, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74]), // `</script`
  StyleEnd: new Uint8Array([0x3c, 0x2f, 0x73, 0x74, 0x79, 0x6c, 0x65]), // `</style`
  TitleEnd: new Uint8Array([0x3c, 0x2f, 0x74, 0x69, 0x74, 0x6c, 0x65]), // `</title`
  TextareaEnd: new Uint8Array([0x3c, 0x2f, 0x74, 0x65, 0x78, 0x74, 0x61, 0x72, 0x65, 0x61]), // `</textarea`
  XmpEnd: new Uint8Array([0x3c, 0x2f, 0x78, 0x6d, 0x70]), // `</xmp`
};

const specialStartSequences = new Map([
  [Sequences.IframeEnd[2], Sequences.IframeEnd],
  [Sequences.NoembedEnd[2], Sequences.NoembedEnd],
  [Sequences.Plaintext[2], Sequences.Plaintext],
  [Sequences.ScriptEnd[2], Sequences.ScriptEnd],
  [Sequences.TitleEnd[2], Sequences.TitleEnd],
  [Sequences.XmpEnd[2], Sequences.XmpEnd],
]);

export class HtmlTokenizer {
  constructor({ xmlMode = false, recognizeSelfClosing = xmlMode } = {}, cbs) {
    this.cbs = cbs;
    this.xmlMode = xmlMode;
    this.recognizeSelfClosing = recognizeSelfClosing;
    this.state = State.Text;
    this.buffer = "";
    this.sectionStart = 0;
    this.index = 0;
    this.isSpecial = false;
    this.running = true;
    this.offset = 0;
    this.currentSequence = Sequences.Empty;
    this.sequenceIndex = 0;
  }

  reset() {
    this.state = State.Text;
    this.buffer = "";
    this.sectionStart = 0;
    this.index = 0;
    this.isSpecial = false;
    this.currentSequence = Sequences.Empty;
    this.sequenceIndex = 0;
    this.running = true;
    this.offset = 0;
  }

  write(chunk) {
    this.offset += this.buffer.length;
    this.buffer = chunk;
    this.parse();
  }

  end() {
    if (this.running) this.finish();
  }

  pause() {
    this.running = false;
  }

  resume() {
    this.running = true;
    if (this.index < this.buffer.length + this.offset) {
      this.parse();
    }
  }

  stateText(c) {
    if (c === CharCodes.Lt || this.fastForwardTo(CharCodes.Lt)) {
      if (this.index > this.sectionStart) {
        this.cbs.ontext(this.sectionStart, this.index);
      }
      this.state = State.BeforeTagName;
      this.sectionStart = this.index;
    }
  }

  enterTagBody() {
    if (this.currentSequence === Sequences.Plaintext) {
      this.currentSequence = Sequences.Empty;
      this.state = State.InPlainText;
    } else if (this.isSpecial) {
      this.state = State.InSpecialTag;
      this.sequenceIndex = 0;
    } else {
      this.state = State.Text;
    }
  }

  stateSpecialStartSequence(c) {
    const lower = c | 0x20;
    if (this.sequenceIndex < this.currentSequence.length) {
      if (lower === this.currentSequence[this.sequenceIndex]) {
        this.sequenceIndex++;
        return;
      }
      if (this.sequenceIndex === 3) {
        if (this.currentSequence === Sequences.ScriptEnd && lower === Sequences.StyleEnd[3]) {
          this.currentSequence = Sequences.StyleEnd;
          this.sequenceIndex = 4;
          return;
        }
        if (this.currentSequence === Sequences.TitleEnd && lower === Sequences.TextareaEnd[3]) {
          this.currentSequence = Sequences.TextareaEnd;
          this.sequenceIndex = 4;
          return;
        }
      } else if (
        this.sequenceIndex === 4 &&
        this.currentSequence === Sequences.NoembedEnd &&
        lower === Sequences.NoframesEnd[4]
      ) {
        this.currentSequence = Sequences.NoframesEnd;
        this.sequenceIndex = 5;
        return;
      }
    } else if (isEndOfTagSection(c)) {
      this.sequenceIndex = 0;
      this.state = State.InTagName;
      this.stateInTagName(c);
      return;
    }
    this.isSpecial = false;
    this.currentSequence = Sequences.Empty;
    this.sequenceIndex = 0;
    this.state = State.InTagName;
    this.stateInTagName(c);
  }

  stateCDATASequence(c) {
    if (c === Sequences.Cdata[this.sequenceIndex]) {
      if (++this.sequenceIndex === Sequences.Cdata.length) {
        this.state = State.InCommentLike;
        this.currentSequence = Sequences.CdataEnd;
        this.sequenceIndex = 0;
        this.sectionStart = this.index + 1;
      }
    } else {
      this.sequenceIndex = 0;
      if (this.xmlMode) {
        this.state = State.InDeclaration;
        this.stateInDeclaration(c);
      } else {
        this.state = State.InSpecialComment;
        this.stateInSpecialComment(c);
      }
    }
  }

  fastForwardTo(c) {
    while (++this.index < this.buffer.length + this.offset) {
      if (this.buffer.charCodeAt(this.index - this.offset) === c) {
        return true;
      }
    }
    this.index = this.buffer.length + this.offset - 1;
    return false;
  }

  emitComment(offset) {
    this.cbs.oncomment(this.sectionStart, this.index, offset);
    this.sequenceIndex = 0;
    this.sectionStart = this.index + 1;
    this.state = State.Text;
  }

  stateInCommentLike(c) {
    if (
      !this.xmlMode &&
      this.currentSequence === Sequences.CommentEnd &&
      this.sequenceIndex <= 1 &&
      this.index === this.sectionStart + this.sequenceIndex &&
      c === CharCodes.Gt
    ) {
      this.emitComment(this.sequenceIndex);
    } else if (
      this.currentSequence === Sequences.CommentEnd &&
      this.sequenceIndex === 2 &&
      c === CharCodes.Gt
    ) {
      this.emitComment(2);
    } else if (
      this.currentSequence === Sequences.CommentEnd &&
      this.sequenceIndex === this.currentSequence.length - 1 &&
      c !== CharCodes.Gt
    ) {
      this.sequenceIndex = Number(c === CharCodes.Dash);
    } else if (c === this.currentSequence[this.sequenceIndex]) {
      if (++this.sequenceIndex === this.currentSequence.length) {
        if (this.currentSequence === Sequences.CdataEnd) {
          this.cbs.oncdata(this.sectionStart, this.index, 2);
        } else {
          this.cbs.oncomment(this.sectionStart, this.index, 3);
        }
        this.sequenceIndex = 0;
        this.sectionStart = this.index + 1;
        this.state = State.Text;
      }
    } else if (this.sequenceIndex === 0) {
      if (this.fastForwardTo(this.currentSequence[0])) {
        this.sequenceIndex = 1;
      }
    } else if (c !== this.currentSequence[this.sequenceIndex - 1]) {
      this.sequenceIndex = 0;
    }
  }

  isTagStartChar(c) {
    return this.xmlMode ? !isEndOfTagSection(c) : isASCIIAlpha(c);
  }

  stateInSpecialTag(c) {
    if (this.sequenceIndex === this.currentSequence.length) {
      if (isEndOfTagSection(c)) {
        const endOfText = this.index - this.currentSequence.length;
        if (this.sectionStart < endOfText) {
          const actualIndex = this.index;
          this.index = endOfText;
          this.cbs.ontext(this.sectionStart, endOfText);
          this.index = actualIndex;
        }
        this.isSpecial = false;
        this.sectionStart = endOfText + 2;
        this.stateInClosingTagName(c);
        return;
      }
      this.sequenceIndex = 0;
    }
    if ((c | 0x20) === this.currentSequence[this.sequenceIndex]) {
      this.sequenceIndex += 1;
    } else if (this.sequenceIndex === 0) {
      // Outside RCDATA tags we can fast-forward to '<'.
      if (this.fastForwardTo(CharCodes.Lt)) {
        this.sequenceIndex = 1;
      }
    } else {
      this.sequenceIndex = Number(c === CharCodes.Lt);
    }
  }

  stateBeforeTagName(c) {
    if (c === CharCodes.ExclamationMark) {
      this.state = State.BeforeDeclaration;
      this.sectionStart = this.index + 1;
    } else if (c === CharCodes.Questionmark) {
      if (this.xmlMode) {
        this.state = State.InProcessingInstruction;
        this.sequenceIndex = 0;
        this.sectionStart = this.index + 1;
      } else {
        this.state = State.InSpecialComment;
        this.sectionStart = this.index;
      }
    } else if (this.isTagStartChar(c)) {
      this.sectionStart = this.index;
      const special =
        this.xmlMode || this.cbs.isInForeignContext?.()
          ? undefined
          : specialStartSequences.get(c | 0x20);
      if (special === undefined) {
        this.state = State.InTagName;
      } else {
        this.isSpecial = true;
        this.currentSequence = special;
        this.sequenceIndex = 3;
        this.state = State.SpecialStartSequence;
      }
    } else if (c === CharCodes.Slash) {
      this.state = State.BeforeClosingTagName;
    } else {
      this.state = State.Text;
      this.stateText(c);
    }
  }

  stateInTagName(c) {
    if (isEndOfTagSection(c)) {
      this.cbs.onopentagname(this.sectionStart, this.index);
      this.sectionStart = -1;
      this.state = State.BeforeAttributeName;
      this.stateBeforeAttributeName(c);
    }
  }

  stateBeforeClosingTagName(c) {
    if (isWhitespace(c)) {
      if (!this.xmlMode) {
        this.state = State.InSpecialComment;
        this.sectionStart = this.index;
      }
    } else if (c === CharCodes.Gt) {
      this.state = State.Text;
      if (!this.xmlMode) {
        this.sectionStart = this.index + 1;
      }
    } else {
      this.state = this.isTagStartChar(c) ? State.InClosingTagName : State.InSpecialComment;
      this.sectionStart = this.index;
    }
  }

  stateInClosingTagName(c) {
    if (isEndOfTagSection(c)) {
      this.cbs.onclosetag(this.sectionStart, this.index);
      this.sectionStart = -1;
      this.state = State.AfterClosingTagName;
      this.stateAfterClosingTagName(c);
    }
  }

  stateAfterClosingTagName(c) {
    if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
      this.state = State.Text;
      this.sectionStart = this.index + 1;
    }
  }

  stateBeforeAttributeName(c) {
    if (c === CharCodes.Gt) {
      this.cbs.onopentagend(this.index);
      this.enterTagBody();
      this.sectionStart = this.index + 1;
    } else if (c === CharCodes.Slash) {
      this.state = State.InSelfClosingTag;
    } else if (!isWhitespace(c)) {
      this.state = State.InAttributeName;
      this.sectionStart = this.index;
    }
  }

  stateInSelfClosingTag(c) {
    if (c === CharCodes.Gt) {
      this.cbs.onselfclosingtag(this.index);
      this.sectionStart = this.index + 1;
      if (!this.recognizeSelfClosing) {
        this.enterTagBody();
        return;
      }
      this.state = State.Text;
      this.isSpecial = false;
      this.currentSequence = Sequences.Empty;
    } else if (!isWhitespace(c)) {
      this.state = State.BeforeAttributeName;
      this.stateBeforeAttributeName(c);
    }
  }

  stateInAttributeName(c) {
    if (c === CharCodes.Eq || isEndOfTagSection(c)) {
      this.cbs.onattribname(this.sectionStart, this.index);
      this.sectionStart = this.index;
      this.state = State.AfterAttributeName;
      this.stateAfterAttributeName(c);
    }
  }

  stateAfterAttributeName(c) {
    if (c === CharCodes.Eq) {
      this.state = State.BeforeAttributeValue;
    } else if (c === CharCodes.Slash || c === CharCodes.Gt) {
      this.cbs.onattribend(QuoteType.NoValue, this.sectionStart);
      this.sectionStart = -1;
      this.state = State.BeforeAttributeName;
      this.stateBeforeAttributeName(c);
    } else if (!isWhitespace(c)) {
      this.cbs.onattribend(QuoteType.NoValue, this.sectionStart);
      this.state = State.InAttributeName;
      this.sectionStart = this.index;
    }
  }

  stateBeforeAttributeValue(c) {
    if (c === CharCodes.DoubleQuote) {
      this.state = State.InAttributeValueDq;
      this.sectionStart = this.index + 1;
    } else if (c === CharCodes.SingleQuote) {
      this.state = State.InAttributeValueSq;
      this.sectionStart = this.index + 1;
    } else if (!isWhitespace(c)) {
      this.sectionStart = this.index;
      this.state = State.InAttributeValueNq;
      this.stateInAttributeValueNoQuotes(c);
    }
  }

  handleInAttributeValue(c, quote) {
    if (c === quote || this.fastForwardTo(quote)) {
      this.cbs.onattribdata(this.sectionStart, this.index);
      this.sectionStart = -1;
      this.cbs.onattribend(
        quote === CharCodes.DoubleQuote ? QuoteType.Double : QuoteType.Single,
        this.index + 1,
      );
      this.state = State.BeforeAttributeName;
    }
  }

  stateInAttributeValueDoubleQuotes(c) {
    this.handleInAttributeValue(c, CharCodes.DoubleQuote);
  }

  stateInAttributeValueSingleQuotes(c) {
    this.handleInAttributeValue(c, CharCodes.SingleQuote);
  }

  stateInAttributeValueNoQuotes(c) {
    if (isWhitespace(c) || c === CharCodes.Gt) {
      this.cbs.onattribdata(this.sectionStart, this.index);
      this.sectionStart = -1;
      this.cbs.onattribend(QuoteType.Unquoted, this.index);
      this.state = State.BeforeAttributeName;
      this.stateBeforeAttributeName(c);
    }
  }

  stateBeforeDeclaration(c) {
    if (c === CharCodes.OpeningSquareBracket) {
      this.state = State.CDATASequence;
      this.sequenceIndex = 0;
    } else if (this.xmlMode) {
      this.state = c === CharCodes.Dash ? State.BeforeComment : State.InDeclaration;
    } else if ((c | 0x20) === Sequences.Doctype[0]) {
      this.state = State.DeclarationSequence;
      this.currentSequence = Sequences.Doctype;
      this.sequenceIndex = 1;
    } else if (c === CharCodes.Gt) {
      this.cbs.oncomment(this.sectionStart, this.index, 0);
      this.state = State.Text;
      this.sectionStart = this.index + 1;
    } else if (c === CharCodes.Dash) {
      this.state = State.BeforeComment;
    } else {
      this.state = State.InSpecialComment;
    }
  }

  stateDeclarationSequence(c) {
    if (this.sequenceIndex === this.currentSequence.length) {
      this.state = State.InDeclaration;
      this.stateInDeclaration(c);
    } else if ((c | 0x20) === this.currentSequence[this.sequenceIndex]) {
      this.sequenceIndex += 1;
    } else if (c === CharCodes.Gt) {
      this.cbs.oncomment(this.sectionStart, this.index, 0);
      this.state = State.Text;
      this.sectionStart = this.index + 1;
    } else {
      this.state = State.InSpecialComment;
    }
  }

  stateInDeclaration(c) {
    if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
      this.cbs.ondeclaration(this.sectionStart, this.index);
      this.state = State.Text;
      this.sectionStart = this.index + 1;
    }
  }

  stateInProcessingInstruction(c) {
    if (c === CharCodes.Questionmark) {
      this.sequenceIndex = 1;
    } else if (c === CharCodes.Gt && this.sequenceIndex === 1) {
      this.cbs.onprocessinginstruction(this.sectionStart, this.index - 1);
      this.sequenceIndex = 0;
      this.state = State.Text;
      this.sectionStart = this.index + 1;
    } else {
      this.sequenceIndex = Number(this.fastForwardTo(CharCodes.Questionmark));
    }
  }

  stateBeforeComment(c) {
    if (c === CharCodes.Dash) {
      this.state = State.InCommentLike;
      this.currentSequence = Sequences.CommentEnd;
      this.sequenceIndex = 0;
      this.sectionStart = this.index + 1;
    } else if (this.xmlMode) {
      this.state = State.InDeclaration;
    } else if (c === CharCodes.Gt) {
      this.cbs.oncomment(this.sectionStart, this.index, 0);
      this.state = State.Text;
      this.sectionStart = this.index + 1;
    } else {
      this.state = State.InSpecialComment;
    }
  }

  stateInSpecialComment(c) {
    if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
      this.cbs.oncomment(this.sectionStart, this.index, 0);
      this.state = State.Text;
      this.sectionStart = this.index + 1;
    }
  }

  cleanup() {
    if (this.running && this.sectionStart !== this.index) {
      if (
        this.state === State.Text ||
        this.state === State.InPlainText ||
        (this.state === State.InSpecialTag && this.sequenceIndex === 0)
      ) {
        this.cbs.ontext(this.sectionStart, this.index);
        this.sectionStart = this.index;
      } else if (
        this.state === State.InAttributeValueDq ||
        this.state === State.InAttributeValueSq ||
        this.state === State.InAttributeValueNq
      ) {
        this.cbs.onattribdata(this.sectionStart, this.index);
        this.sectionStart = this.index;
      }
    }
  }

  shouldContinue() {
    return this.index < this.buffer.length + this.offset && this.running;
  }

  parse() {
    while (this.shouldContinue()) {
      const c = this.buffer.charCodeAt(this.index - this.offset);
      switch (this.state) {
        case State.Text:
          this.stateText(c);
          break;
        case State.InPlainText:
          this.index = this.buffer.length + this.offset - 1;
          break;
        case State.SpecialStartSequence:
          this.stateSpecialStartSequence(c);
          break;
        case State.InSpecialTag:
          this.stateInSpecialTag(c);
          break;
        case State.CDATASequence:
          this.stateCDATASequence(c);
          break;
        case State.DeclarationSequence:
          this.stateDeclarationSequence(c);
          break;
        case State.InAttributeValueDq:
          this.stateInAttributeValueDoubleQuotes(c);
          break;
        case State.InAttributeName:
          this.stateInAttributeName(c);
          break;
        case State.InCommentLike:
          this.stateInCommentLike(c);
          break;
        case State.InSpecialComment:
          this.stateInSpecialComment(c);
          break;
        case State.BeforeAttributeName:
          this.stateBeforeAttributeName(c);
          break;
        case State.InTagName:
          this.stateInTagName(c);
          break;
        case State.InClosingTagName:
          this.stateInClosingTagName(c);
          break;
        case State.BeforeTagName:
          this.stateBeforeTagName(c);
          break;
        case State.AfterAttributeName:
          this.stateAfterAttributeName(c);
          break;
        case State.InAttributeValueSq:
          this.stateInAttributeValueSingleQuotes(c);
          break;
        case State.BeforeAttributeValue:
          this.stateBeforeAttributeValue(c);
          break;
        case State.BeforeClosingTagName:
          this.stateBeforeClosingTagName(c);
          break;
        case State.AfterClosingTagName:
          this.stateAfterClosingTagName(c);
          break;
        case State.InAttributeValueNq:
          this.stateInAttributeValueNoQuotes(c);
          break;
        case State.InSelfClosingTag:
          this.stateInSelfClosingTag(c);
          break;
        case State.InDeclaration:
          this.stateInDeclaration(c);
          break;
        case State.BeforeDeclaration:
          this.stateBeforeDeclaration(c);
          break;
        case State.BeforeComment:
          this.stateBeforeComment(c);
          break;
        case State.InProcessingInstruction:
          this.stateInProcessingInstruction(c);
          break;
      }
      this.index++;
    }
    this.cleanup();
  }

  finish() {
    this.handleTrailingData();
    this.cbs.onend();
  }

  handleTrailingCommentLikeData(endIndex) {
    if (this.state !== State.InCommentLike) return false;
    if (this.currentSequence === Sequences.CdataEnd) {
      if (this.xmlMode) {
        if (this.sectionStart < endIndex) {
          this.cbs.oncdata(this.sectionStart, endIndex, 0);
        }
      } else {
        const cdataStart = this.sectionStart - Sequences.Cdata.length - 1;
        this.cbs.oncomment(cdataStart, endIndex, 0);
      }
    } else {
      const offset = this.xmlMode
        ? 0
        : Math.min(this.sequenceIndex, Sequences.CommentEnd.length - 1);
      this.cbs.oncomment(this.sectionStart, endIndex, offset);
    }
    return true;
  }

  handleTrailingMarkupDeclaration(endIndex) {
    if (this.xmlMode) {
      switch (this.state) {
        case State.InSpecialComment:
        case State.BeforeComment:
        case State.CDATASequence:
        case State.DeclarationSequence:
        case State.InDeclaration:
          this.cbs.ontext(this.sectionStart, endIndex);
          return true;
        default:
          return false;
      }
    }
    switch (this.state) {
      case State.BeforeDeclaration:
      case State.InSpecialComment:
      case State.BeforeComment:
      case State.CDATASequence:
        this.cbs.oncomment(this.sectionStart, endIndex, 0);
        return true;
      case State.DeclarationSequence:
        if (this.sequenceIndex !== Sequences.Doctype.length) {
          this.cbs.oncomment(this.sectionStart, endIndex, 0);
        }
        return true;
      case State.InDeclaration:
        return true;
      default:
        return false;
    }
  }

  handleTrailingData() {
    const endIndex = this.buffer.length + this.offset;
    if (
      this.handleTrailingCommentLikeData(endIndex) ||
      this.handleTrailingMarkupDeclaration(endIndex)
    ) {
      return;
    }
    if (this.sectionStart >= endIndex) return;
    switch (this.state) {
      case State.InTagName:
      case State.BeforeAttributeName:
      case State.BeforeAttributeValue:
      case State.AfterAttributeName:
      case State.InAttributeName:
      case State.InAttributeValueSq:
      case State.InAttributeValueDq:
      case State.InAttributeValueNq:
      case State.InClosingTagName:
        // In an open tag — not calling the callback signals "ignore the tag."
        break;
      default:
        this.cbs.ontext(this.sectionStart, endIndex);
    }
  }
}
