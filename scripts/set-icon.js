const fs = require('fs');
const path = require('path');
const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit');

const exePath = path.join(__dirname, '..', 'dist', 'LeadHunter.exe');
const icoPath = path.join(__dirname, '..', 'public', 'logo.ico');

const data = fs.readFileSync(exePath);
const exe = NtExecutable.from(data, { ignoreCert: true });
const res = NtExecutableResource.from(exe);

const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  1,
  1033,
  iconFile.icons.map((item) => item.data)
);

res.outputResource(exe);
const newBinary = Buffer.from(exe.generate());
fs.writeFileSync(exePath, newBinary);
console.log('Icon embedded into', exePath, 'size:', newBinary.length);
