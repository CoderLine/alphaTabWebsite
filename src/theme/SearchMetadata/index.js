// TODO: remove this swizzled file once https://github.com/cmfcmf/docusaurus-search-local/pull/103 is resolved

/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import React from 'react';
import Head from '@docusaurus/Head';
// Note: we bias toward using Algolia metadata on purpose
// Not doing so leads to confusion in the community,
// as it requires to first crawl the site with the Algolia plugin enabled first
// - https://github.com/facebook/docusaurus/issues/6693
// - https://github.com/facebook/docusaurus/issues/4555
export default function SearchMetadata({locale, version, tag}) {
  // Seems safe to consider here the locale is the language, as the existing
  // docsearch:language filter is afaik a regular string-based filter
  const language = locale;
  return (
    <Head>
      {language && <meta name="docsearch:language" content={language} />}
      {version && <meta name="docsearch:version" content={version} />}
      {tag && <meta name="docsearch:docusaurus_tag" content={tag} />}
      {tag && <meta name="docusaurus_tag" content={tag} />}
    </Head>
  );
}
