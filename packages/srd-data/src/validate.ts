import { datasets } from './index.js';

let failed = 0;

for (const { name, schema, raw } of datasets) {
  const result = schema.safeParse(raw);
  if (result.success) {
    console.log(`ok    ${name} (${result.data.length} entries)`);
  } else {
    failed++;
    console.error(`FAIL  ${name}`);
    for (const issue of result.error.issues) {
      console.error(`      ${issue.path.join('.')}: ${issue.message}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed schema validation`);
  process.exit(1);
}
console.log(`\nall ${datasets.length} file(s) valid`);
