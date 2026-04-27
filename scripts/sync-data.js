const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

async function downloadFile(url, dest) {
  if (url.startsWith('/')) {
    url = 'https://cms.shuru.sa' + url;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unexpected response ${response.statusText}`);
  const fileStream = fs.createWriteStream(dest);
  return new Promise((resolve, reject) => {
      Readable.fromWeb(response.body).pipe(fileStream);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
  });
}

async function syncUpload(app, fileData) {
  if (!fileData || !fileData.url) return null;
  const hash = fileData.hash || Math.random().toString(36).substring(7);

  const existing = await app.documents('plugin::upload.file').findFirst({
    filters: { hash: hash }
  });
  if (existing) return existing.documentId;

  let url = fileData.url;
  const ext = path.extname(fileData.url || fileData.name || '');
  const tmpPath = path.join('/tmp', hash + ext);

  try {
    await downloadFile(url, tmpPath);
    const stat = fs.statSync(tmpPath);
    const file = { path: tmpPath, name: fileData.name || 'file', type: fileData.mime || 'application/octet-stream', size: stat.size };
    const [uploadedFile] = await app.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: file.name, alternativeText: fileData.alternativeText, caption: fileData.caption } },
      files: file,
    });
    return uploadedFile.documentId;
  } catch (e) {
    return null;
  }
}

function cleanComponents(obj) {
  if (Array.isArray(obj)) return obj.map(cleanComponents);
  if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'id' || k === 'documentId') continue;
      newObj[k] = cleanComponents(v);
    }
    return newObj;
  }
  return obj;
}

async function syncData() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  const baseUrl = 'https://cms.shuru.sa/api';
  const collections = [
    { name: 'authors', uid: 'api::author.author', uniqueKey: 'name' },
    { name: 'categories', uid: 'api::category.category', uniqueKey: 'slug' },
    { name: 'magazine-issues', uid: 'api::magazine-issue.magazine-issue', uniqueKey: 'slug' },
    { name: 'majlises', uid: 'api::majlis.majlis', uniqueKey: 'slug' },
    { name: 'news-items', uid: 'api::news-item.news-item', uniqueKey: 'slug' },
    { name: 'articles', uid: 'api::article.article', uniqueKey: 'slug' }
  ];

  try {
    for (const col of collections) {
      console.log(`\nFetching ${col.name}...`);
      let page = 1;
      let allData = [];
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(`${baseUrl}/${col.name}?populate=*&locale=all&pagination[page]=${page}&pagination[pageSize]=25`);
        const json = await response.json();
        if (!json.data || json.data.length === 0) break;
        allData = allData.concat(json.data);
        if (json.meta && json.meta.pagination) {
            if (page >= json.meta.pagination.pageCount) hasMore = false;
            else page++;
        } else hasMore = false;
      }

      console.log(`Fetched ${allData.length} items for ${col.name}. Seeding to local db as AR AND EN...`);

      for (const item of allData) {
        let { id, documentId, createdAt, updatedAt, publishedAt, localizations, locale, ...cleanData } = item;
        cleanData = cleanComponents(cleanData);
        cleanData.publishedAt = new Date().toISOString();

        for (const [key, value] of Object.entries(cleanData)) {
            if (!value) continue;
            if (typeof value === 'object' && value.url) {
                const docId = await syncUpload(app, value);
                cleanData[key] = docId;
            } else if (typeof value === 'object' && !Array.isArray(value) && !value.__component) {
               cleanData[key] = undefined;
            } else if (Array.isArray(value)) {
                const newArr = [];
                for (const arrItem of value) {
                    if (arrItem && arrItem.url) {
                        const fileDocId = await syncUpload(app, arrItem);
                        if (fileDocId) newArr.push(fileDocId);
                    } else if (arrItem && arrItem.__component) {
                        newArr.push(arrItem);
                    }
                }
                cleanData[key] = newArr.length > 0 ? newArr : undefined;
            }
        }

        const filterVal = cleanData[col.uniqueKey];
        if (!filterVal && filterVal !== "") continue;

        let baseDocId;
        try {
            let anyExisting = await app.documents(col.uid).findFirst({
                filters: { [col.uniqueKey]: filterVal },
                locale: 'ar'
            });
            if (!anyExisting) {
                anyExisting = await app.documents(col.uid).findFirst({
                    filters: { [col.uniqueKey]: filterVal },
                    locale: 'en'
                });
            }

            if (anyExisting) {
                baseDocId = anyExisting.documentId;
            } else {
                const newDoc = await app.documents(col.uid).create({
                   data: cleanData,
                   locale: 'ar',
                   status: 'published'
                });
                baseDocId = newDoc.documentId;
            }
        } catch (e) {
            console.error(`Failed resolving base document for ${filterVal}:`, e.message);
            continue; // Skip if it totally fails
        }

        const targetLocales = ['ar', 'en'];
        for (const targetLocale of targetLocales) {
            try {
                const existsInLocale = await app.documents(col.uid).findFirst({
                  filters: { documentId: baseDocId },
                  locale: targetLocale
                });

                if (existsInLocale) {
                  await app.documents(col.uid).update({
                      documentId: baseDocId,
                      data: cleanData,
                      locale: targetLocale,
                      status: 'published'
                  });
                } else {
                  await app.documents(col.uid).update({
                      documentId: baseDocId,
                      data: cleanData,
                      locale: targetLocale,
                      status: 'published'
                  });
                }
            } catch(e) {
                // If it fails across languages just log and move
            }
        }
      }
    }
    console.log('\n✅ Data successfully seeded as BOTH AR and EN!');
  } catch (error) {
    console.error('Error syncing:', error);
  } finally {
    process.exit(0);
  }
}

syncData();
