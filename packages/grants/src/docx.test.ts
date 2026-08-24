/**
 * `word/document.xml` -> paragraphs. Built by hand rather than a fixture .docx, so the test
 * has no binary checked in and stays readable: this is the exact shape corpus_search.py reads
 * (a run of `<w:p>` elements, tags stripped, XML entities decoded), not a full OOXML render.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';

import { extractDocxParagraphs, extractDocxText } from './docx.js';

async function fakeDocx(documentXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractDocxParagraphs', () => {
  it('extracts one paragraph per <w:p>, tags stripped and whitespace collapsed', async () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Statement of Need</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Launchpad   serves</w:t></w:r><w:r><w:t> Philadelphia youth.</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const paras = await extractDocxParagraphs(await fakeDocx(xml));
    expect(paras).toEqual(['Statement of Need', 'Launchpad serves Philadelphia youth.']);
  });

  it('decodes XML entities', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>R&amp;D at 90% &gt; target</w:t></w:r></w:p></w:body></w:document>';
    const paras = await extractDocxParagraphs(await fakeDocx(xml));
    expect(paras).toEqual(['R&D at 90% > target']);
  });

  it('drops empty paragraphs', async () => {
    const xml = '<w:document><w:body><w:p></w:p><w:p><w:r><w:t>Real text</w:t></w:r></w:p></w:body></w:document>';
    const paras = await extractDocxParagraphs(await fakeDocx(xml));
    expect(paras).toEqual(['Real text']);
  });
});

describe('extractDocxText', () => {
  it('joins paragraphs with newlines', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>One</w:t></w:r></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:body></w:document>';
    expect(await extractDocxText(await fakeDocx(xml))).toBe('One\nTwo');
  });
});
