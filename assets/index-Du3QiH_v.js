var e=(e,t)=>()=>(t||(e((t={exports:{}}).exports,t),e=null),t.exports);(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();function t(e,t){if(e.versionMajor===1){if(e.versionMinor<=1)return`unsupported`;if(e.versionMinor===2)return`laz-1.2`;if(e.versionMinor===3)return`laz-1.3`;if(e.versionMinor===4)return t.isLayered?`laz-1.4`:`laz-1.3`}return`unsupported`}function n(e){return e===`laz-1.2`||e===`laz-1.3`?`This file uses an older compression format — loading will be slower. Convert to LAZ 1.4 (PDRF 6+) for better performance.`:e===`unsupported`?`Unsupported format. lazstream requires compressed LAZ files (LAZ 1.2–1.4). Uncompressed LAS files are too large to stream.`:null}var r=class extends Error{constructor(e){super(e),this.name=`SecurityError`}},i=[/^10\./,/^172\.(1[6-9]|2\d|3[01])\./,/^192\.168\./,/^127\./,/^169\.254\./,/^0\.0\.0\.0$/,/^::1$/,/^::$/,/^fc00:/,/^fe80:/,/^::ffff:10\./,/^::ffff:172\.(1[6-9]|2\d|3[01])\./,/^::ffff:192\.168\./,/^::ffff:127\./,/^::ffff:169\.254\./];function a(e){return i.some(t=>t.test(e))}function o(e){return e===`localhost`||e===`127.0.0.1`||e===`::1`}function s(e,t,n){let i=e.trim(),s;try{s=new URL(i)}catch{throw new r(`Invalid URL: "${i}"`)}let c=[`https:`];if(o(s.hostname)&&c.push(`http:`),!c.includes(s.protocol))throw new r(`Blocked URL scheme "${s.protocol}". Only HTTPS URLs are supported.`);if(a(s.hostname)&&!o(s.hostname))throw new r(`Blocked private IP address "${s.hostname}".`);if(!s.pathname.toLowerCase().endsWith(t))throw new r(`URL does not point to ${n}. Expected a path ending in "${t}".`);return s}function c(e){return s(e,`.laz`,`a LAZ file`)}function l(e){return s(e,`.lazm.json`,`a manifest file`)}function u(){let e=new URLSearchParams(window.location.search),t=e.get(`manifest`);if(t)return{type:`manifest`,url:t};let n=e.get(`url`);return n?{type:`laz`,url:n}:null}var d=class extends Error{statusCode;url;constructor(e,t,n){super(e),this.statusCode=t,this.url=n,this.name=`NetworkError`}},f=class extends Error{url;constructor(e,t=`blocked`){super(t===`expose-headers`?`Server does not expose Content-Range — add Access-Control-Expose-Headers: Content-Range, Content-Length to the bucket CORS config`:`Could not reach file — CORS headers are missing. The server must send Access-Control-Allow-Origin and Access-Control-Allow-Headers: Range`),this.url=e,this.name=`CorsError`}};async function p(e,t,n,r){let i;try{i=await fetch(e,{headers:{Range:`bytes=${t}-${n}`},cache:`no-store`,signal:r})}catch(t){throw t instanceof TypeError?new f(e):t}if(i.status!==206&&i.status!==200)throw new d(`Range request failed with status ${i.status}`,i.status,e);if(i.url&&i.url!==e){let t=new URL(e).origin,n=new URL(i.url).origin;if(t!==n)throw new d(`Blocked cross-origin redirect from "${t}" to "${n}".`,0,e)}return i.arrayBuffer()}async function m(e,t){let n;try{n=await fetch(e,{method:`HEAD`,cache:`no-store`,signal:t})}catch(t){throw t instanceof TypeError?new f(e):t}if(!n.ok)throw new d(`File not accessible (HTTP ${n.status}). Check that the file is publicly accessible and CORS is enabled.`,n.status,e);let r=n.headers.get(`Content-Length`),i=r?parseInt(r,10):0;if(n.headers.get(`Accept-Ranges`)!==`bytes`){let n;try{n=await fetch(e,{headers:{Range:`bytes=0-0`},cache:`no-store`,signal:t})}catch(t){throw t instanceof TypeError?new f(e):t}if(n.status===206){if(i===0){let t=n.headers.get(`Content-Range`);if(!t)throw new f(e,`expose-headers`);let r=t.match(/\/(\d+)$/);r&&(i=parseInt(r[1],10))}return{fileSize:i,supportsRange:!0}}return{fileSize:i,supportsRange:!1}}return{fileSize:i,supportsRange:!0}}function h(e,t={}){let n=t.maxBatchBytes??4194304,r=t.maxGapBytes??65536;if(e.length===0)return[];let i=[...e].sort((e,t)=>e.chunk.offset-t.chunk.offset),a=[],o=null;for(let e of i){let t=e.chunk.offset+e.chunk.compressedSize;o!==null&&e.chunk.offset-o.end<=r&&t-o.start<=n?(o.chunks.push(e),o.end=t):(o!==null&&a.push(o),o={start:e.chunk.offset,end:t,chunks:[e]})}return o!==null&&a.push(o),a}var g=`LASF`,_=`laszip encoded`,v=22204,y=class extends Error{constructor(e){super(e),this.name=`ParseError`}};function b(e){if(e.byteLength<255)throw new y(`File too small to be a valid LAS file (${e.byteLength} bytes). Minimum LAS header is 227 bytes.`);let t=String.fromCharCode(e.getUint8(0),e.getUint8(1),e.getUint8(2),e.getUint8(3));if(t!==g)throw new y(`Invalid LAS file — expected "LASF" signature, got "${t}". This may not be a LAS/LAZ file.`);let n=e.getUint8(24),r=e.getUint8(25);if(n!==1||r<2)throw new y(`Unsupported LAS version ${n}.${r}. lazstream supports LAS 1.2, 1.3, and 1.4 compressed as LAZ.`);let i=e.getUint16(94,!0),a=e.getUint32(96,!0),o=e.getUint32(100,!0),s=e.getUint8(104)&127,c=e.getUint16(105,!0);if(s>10)throw new y(`Unsupported point data record format ${s}. Valid formats are 0–10.`);let l;if(r>=4){let t=e.getUint32(247,!0);l=e.getUint32(251,!0)*4294967296+t}else l=e.getUint32(107,!0);let u=e.getFloat64(131,!0),d=e.getFloat64(139,!0),f=e.getFloat64(147,!0);if(!Number.isFinite(u)||!Number.isFinite(d)||!Number.isFinite(f)||u===0||d===0||f===0)throw new y(`Invalid scale factors in LAS header (${u}, ${d}, ${f}). Scale must be non-zero finite values.`);let p=e.getFloat64(155,!0),m=e.getFloat64(163,!0),h=e.getFloat64(171,!0);if(!Number.isFinite(p)||!Number.isFinite(m)||!Number.isFinite(h))throw new y(`Invalid coordinate offsets in LAS header (${p}, ${m}, ${h}). Offsets must be finite values.`);let _=e.getFloat64(179,!0),v=e.getFloat64(187,!0),b=e.getFloat64(195,!0),x=e.getFloat64(203,!0),S=e.getFloat64(211,!0),C=e.getFloat64(219,!0);return{fileSignature:t,versionMajor:n,versionMinor:r,pointDataRecordFormat:s,pointDataRecordLength:c,pointCount:l,minX:v,maxX:_,minY:x,maxY:b,minZ:C,maxZ:S,scaleX:u,scaleY:d,scaleZ:f,offsetX:p,offsetY:m,offsetZ:h,headerSize:i,pointDataOffset:a,numberOfVLRs:o}}function x(e,t){let n=new DataView(e),r=t.headerSize;for(let i=0;i<t.numberOfVLRs&&!(r+54>e.byteLength);i++){let e=``;for(let t=0;t<16;t++){let i=n.getUint8(r+2+t);if(i===0)break;e+=String.fromCharCode(i)}let i=n.getUint16(r+18,!0),a=n.getUint16(r+20,!0),o=r+54;if(e===_&&i===v)return S(n,o,t.pointDataRecordFormat,t.pointDataRecordLength);r=o+a}throw new y(`No LAZ VLR found in this file. This may be an uncompressed LAS file. lazstream only supports LAZ-compressed files.`)}function S(e,t,n,r){let i=e.getUint16(t+0,!0),a=e.getUint32(t+12,!0),o=n;i===3&&n===0&&(o={30:6,36:7,38:8,59:9,67:10}[r]??6,console.warn(`[header] PDRF byte reads as 0 for layered compressor — derived PDRF ${o} from record length ${r}`));let s=i===3;return{compressor:i,chunkSize:a===4294967295?0:a,pointDataRecordFormat:o,numItems:e.getUint16(t+32,!0),isLayered:s}}async function C(e,t){let n=8192,r=await p(e,0,n-1,t),i=new DataView(r),a=b(i);if(a.pointDataOffset>n){if(a.pointDataOffset>1048576)throw new y(`Header offset to point data (${a.pointDataOffset} bytes) is implausibly large. The file may be malformed or corrupted.`);r=await p(e,0,a.pointDataOffset-1,t),i=new DataView(r)}let o=x(r,a);return o.pointDataRecordFormat!==a.pointDataRecordFormat&&(a.pointDataRecordFormat=o.pointDataRecordFormat),{header:a,lazVlr:o,buffer:r}}var w=16777216,T=13,E=8191,D=15,ee=16383,te=class{bit0Prob=0;bit0Count=0;bitCount=0;updateCycle=0;bitsUntilUpdate=0;constructor(){this.init()}init(){this.bit0Count=1,this.bitCount=2,this.bit0Prob=1<<T-1,this.updateCycle=this.bitsUntilUpdate=4}update(){this.bitCount+=this.updateCycle,this.bitCount>E&&(this.bitCount=this.bitCount+1>>>1,this.bit0Count=this.bit0Count+1>>>1,this.bit0Count===this.bitCount&&this.bitCount++);let e=2147483648/this.bitCount>>>0;this.bit0Prob=Math.imul(this.bit0Count,e)>>>31-T>>>0,this.updateCycle=5*this.updateCycle>>>2,this.updateCycle>64&&(this.updateCycle=64),this.bitsUntilUpdate=this.updateCycle}},O=class{symbols;lastSymbol;distribution;symbolCount;decoderTable=null;tableShift=0;tableSize=0;totalCount=0;updateCycle=0;symbolsUntilUpdate=0;constructor(e){if(e<2||e>2048)throw Error(`ArithmeticModel: invalid symbol count ${e}`);if(this.symbols=e,this.lastSymbol=e-1,this.distribution=new Uint32Array(e+1),this.symbolCount=new Uint32Array(e),e>16){let t=3;for(;e>1<<t+2;)t++;this.tableSize=1<<t,this.tableShift=D-t,this.decoderTable=new Uint32Array(this.tableSize+2)}else this.decoderTable=null,this.tableSize=0,this.tableShift=0}init(e){if(this.totalCount=0,this.updateCycle=this.symbols,e)for(let t=0;t<this.symbols;t++)this.symbolCount[t]=e[t];else for(let e=0;e<this.symbols;e++)this.symbolCount[e]=1;this.update(),this.symbolsUntilUpdate=this.updateCycle=this.symbols+6>>>1}update(){if(this.totalCount+=this.updateCycle,this.totalCount>ee){this.totalCount=0;for(let e=0;e<this.symbols;e++)this.symbolCount[e]=this.symbolCount[e]+1>>>1,this.totalCount+=this.symbolCount[e]}let e=2147483648/this.totalCount>>>0,t=0,n=0;if(this.decoderTable){for(let r=0;r<this.symbols;r++){this.distribution[r]=Math.imul(e,t)>>>31-D>>>0,t+=this.symbolCount[r];let i=this.distribution[r]>>>this.tableShift;for(;n<i;)n++,this.decoderTable[n]=r-1}for(this.decoderTable[0]=0;n<=this.tableSize;)n++,this.decoderTable[n]=this.symbols-1}else for(let n=0;n<this.symbols;n++)this.distribution[n]=Math.imul(e,t)>>>31-D>>>0,t+=this.symbolCount[n];this.distribution[this.symbols]=1<<D,this.updateCycle=5*this.updateCycle>>>2;let r=this.symbols+6<<3;this.updateCycle>r&&(this.updateCycle=r),this.symbolsUntilUpdate=this.updateCycle}},ne=class{value=0;length=0;data;pos=0;constructor(e){this.data=e,this.pos=0}init(){this.value=(this.readByte()<<24|this.readByte()<<16|this.readByte()<<8|this.readByte())>>>0,this.length=4294967295}decodeBit(e){let t=Math.imul(e.bit0Prob,this.length>>>T)>>>0,n=+(this.value>=t);return n===0?(this.length=t,e.bit0Count++):(this.value=this.value-t>>>0,this.length=this.length-t>>>0),this.length<w&&this.renormalize(),e.bitsUntilUpdate--,e.bitsUntilUpdate===0&&e.update(),n}decodeSymbol(e){let t,n,r,i=this.length;if(e.decoderTable){this.length=this.length>>>D>>>0;let a=this.value/this.length>>>0,o=a>>>e.tableShift;for(n=e.decoderTable[o],t=e.decoderTable[o+1]+1;t>n+1;){let r=n+t>>>1;e.distribution[r]>a?t=r:n=r}r=Math.imul(e.distribution[n],this.length)>>>0,n!==e.lastSymbol&&(i=Math.imul(e.distribution[n+1],this.length)>>>0)}else{r=0,n=0,this.length=this.length>>>D>>>0,t=e.symbols;let a=t>>>1;do{let o=Math.imul(this.length,e.distribution[a])>>>0;o>this.value?(t=a,i=o):(n=a,r=o)}while((a=n+t>>>1)!==n)}return this.value=this.value-r>>>0,this.length=i-r>>>0,this.length<w&&this.renormalize(),e.symbolCount[n]++,e.symbolsUntilUpdate--,e.symbolsUntilUpdate===0&&e.update(),n}readBits(e){if(e>19){let t=this.readShort();return(this.readBits(e-16)<<16|t)>>>0}this.length=this.length>>>e>>>0;let t=this.value/this.length>>>0;return this.value=this.value-Math.imul(t,this.length)>>>0,this.length<w&&this.renormalize(),t}readShort(){this.length=this.length>>>16>>>0;let e=this.value/this.length>>>0;return this.value=this.value-Math.imul(e,this.length)>>>0,this.length<w&&this.renormalize(),e}renormalize(){if(this.length===0)throw Error(`ArithmeticDecoder: renormalize called with length=0 — decoder state corrupt`);do this.value=(this.value<<8|this.readByte())>>>0,this.length=this.length<<8>>>0;while(this.length<w)}readByte(){return this.pos>=this.data.length?0:this.data[this.pos++]}},re=class{contexts;bitsHigh;corrBits;corrRange;corrMin;dec;mBits;mCorrector0;mCorrector;constructor(e,t=16,n=1,r=8){this.dec=e,this.contexts=n,this.bitsHigh=r,t>0&&t<32?(this.corrBits=t,this.corrRange=1<<t,this.corrMin=-(this.corrRange>>>1)):(this.corrBits=32,this.corrRange=0,this.corrMin=-2147483648),this.mBits=Array(n);for(let e=0;e<n;e++)this.mBits[e]=new O(this.corrBits+1);this.mCorrector0=new te,this.mCorrector=Array(this.corrBits+1).fill(null);for(let e=1;e<=this.corrBits;e++)e<=r?this.mCorrector[e]=new O(1<<e):this.mCorrector[e]=new O(1<<r)}initDecompressor(){for(let e=0;e<this.contexts;e++)this.mBits[e].init();this.mCorrector0.init();for(let e=1;e<=this.corrBits;e++)this.mCorrector[e].init()}decompress(e,t){let n=e+this.readCorrector(this.mBits[t])|0;return this.corrRange>0&&(n<0?n+=this.corrRange:n>>>0>=this.corrRange>>>0&&(n-=this.corrRange)),n}readCorrector(e){let t=this.dec.decodeSymbol(e),n;if(t!==0)if(t<32){if(t<=this.bitsHigh)n=this.dec.decodeSymbol(this.mCorrector[t]);else{let e=t-this.bitsHigh;n=this.dec.decodeSymbol(this.mCorrector[t]);let r=this.dec.readBits(e);n=n<<e|r}let e=1<<t-1;n>=e?n+=1:n-=(1<<t)-1}else n=this.corrMin;else n=this.dec.decodeBit(this.mCorrector0);return n}},k=class extends Error{constructor(e){super(e),this.name=`ChunkTableError`}};async function ie(e,t,n,r,i){let a=t.pointDataOffset,o=a+8;console.debug(`[lazstream] fetchChunkTable called:`,{pointDataOffset:a,fileSize:r,lazVlrChunkSize:n.chunkSize});let s=await p(e,a,a+7,i),c=new DataView(s),l=c.getUint32(0,!0),u=c.getUint32(4,!0),d=u*4294967296+l;if(console.debug(`[lazstream] pointer buffer:`,{byteLength:s.byteLength,bytes:Array.from(new Uint8Array(s)).map(e=>`0x`+e.toString(16).padStart(2,`0`)).join(` `),ptrLo:l,ptrHi:u,chunkTableAbsoluteOffset:d}),d===0&&(d=o,console.debug(`[lazstream] chunk table pointer is 0 — table at pointDataOffset + 8`)),d>=r)throw new k(`Chunk table pointer (${d}) is beyond the end of file (${r} bytes). The file may be truncated. Re-download or re-upload the source LAZ file.`);console.debug(`[lazstream] chunk table at:`,{chunkTableAbsoluteOffset:d,bytesFromEOF:r-d});let f=await p(e,d,r-1,i),m=new DataView(f),h=m.getUint32(0,!0),g=m.getUint32(4,!0);if(console.debug(`[lazstream] chunk table header:`,{version:h,chunkCount:g,compressedDataBytes:f.byteLength-8}),h!==0)throw new k(`Unknown chunk table version ${h}. Expected 0.`);if(g===0)throw new k(`Chunk table reports 0 chunks.`);let _=5e6;if(g>_)throw new k(`Chunk count ${g} exceeds maximum (${_}). The file may be malformed or corrupted.`);let v=n.chunkSize>0?n.chunkSize:5e4,y=Math.ceil(t.pointCount/v),b=g/y;(b<.5||b>2)&&console.warn(`[lazstream] chunk count mismatch: table says ${g}, estimated ${y} from header.`);let x=new ne(new Uint8Array(f,8,f.byteLength-8));x.init();let S=new re(x,32,2,8);S.initDecompressor();let C=new Uint32Array(g+1),w=performance.now();for(let e=1;e<=g;e++){let t=e>1?C[e-1]:0;C[e]=S.decompress(t,1)}let T=performance.now()-w;console.log(`[lazstream] arithmetic decode: ${g} entries in ${T.toFixed(1)}ms (${(T/g*1e3).toFixed(2)}µs/entry)`);let E=new Uint32Array(g+1);E[0]=o;for(let e=1;e<=g;e++)E[e]=E[e-1]+C[e]>>>0;console.debug(`[lazstream] first 5 chunk offsets:`,{offsets:Array.from(E.slice(0,5)),sizes:Array.from(E.slice(1,5)).map((e,t)=>e-E[t])});let D=[];for(let e=0;e<g;e++){let n=E[e],i=E[e+1]-E[e]>>>0;if(i===0){console.warn(`[lazstream] chunk ${e}: zero size — stopping`);break}if(i>r){console.warn(`[lazstream] chunk ${e}: size ${i} exceeds file size ${r} — stopping`);break}if(n>=r){console.warn(`[lazstream] chunk ${e}: offset ${n} beyond file size ${r} — stopping`);break}let a=t.pointCount-e*v,o=Math.min(v,a);D.push({offset:n,compressedSize:i,pointCount:o})}if(D.length===0)throw new k(`No valid chunk entries after decompression.`);D.length<g&&console.warn(`[lazstream] only ${D.length} of ${g} chunks produced valid offsets — proceeding with partial set`);let ee=D[D.length-1],te=ee.offset+ee.compressedSize,O=d-te;return console.debug(`[lazstream] chunk table parsed:`,{chunkCount:D.length,firstChunkOffset:D[0].offset,lastChunkEnd:te,chunkTableStart:d,gapToTable:O,avgChunkSize:Math.round(D.reduce((e,t)=>e+t.compressedSize,0)/D.length)}),Math.abs(O)>1024&&console.warn(`[lazstream] chunk offsets overshoot/undershoot chunk table by ${O} bytes — decompression may have errors`),D}async function ae(e,t,n,r,i,a){let o=[],s=n.pointDataRecordFormat>=6,c=r.chunkSize===0?4:0,l=n.pointDataRecordLength;console.debug(`[lazstream] fetching seed points:`,{chunkCount:t.length,isPdrf6Plus:s,seedByteOffset:c,seedByteLength:l});for(let r=0;r<t.length;r+=100){if(a?.aborted)return o;let u=Math.min(r+100,t.length),d=t.slice(r,u),f=await Promise.all(d.map(t=>{let n=t.offset+c;return p(e,n,n+l-1,a)}));for(let e=0;e<f.length;e++){let t=f[e],i=new DataView(t),a=r+e;if(t.byteLength<12){console.warn(`[lazstream] seed for chunk ${a} too short (${t.byteLength}b) — skipping`);continue}let c=i.getInt32(0,!0),l=i.getInt32(4,!0),u=i.getInt32(8,!0),d=c*n.scaleX+n.offsetX,p=l*n.scaleY+n.offsetY,m=u*n.scaleZ+n.offsetZ;if(d<n.minX-10||d>n.maxX+10||p<n.minY-10||p>n.maxY+10){console.warn(`[lazstream] seed ${a} out of bounds: (${d.toFixed(2)}, ${p.toFixed(2)}) vs bbox (${n.minX.toFixed(2)}–${n.maxX.toFixed(2)}, ${n.minY.toFixed(2)}–${n.maxY.toFixed(2)})`);continue}let h=i.getUint16(12,!0),g=s?i.getUint8(16):i.getUint8(15);o.push({x:d,y:p,z:m,intensity:h,classification:g,chunkIndex:a})}i?.(u,t.length)}return o.length>0&&(console.debug(`[lazstream] first seed point:`,{x:o[0].x.toFixed(4),y:o[0].y.toFixed(4),z:o[0].z.toFixed(4),classification:o[0].classification}),console.debug(`[lazstream] ${o.length} / ${t.length} seed points extracted`)),o}var oe=class{workers=[];queue=[];events;header=null;lazVlr=null;intensitySeedRange=null;readyCount=0;targetCount;disposed=!1;assetUrls;inFlight=new Set;completed=new Set;pendingAttrs=new Map;attrQueue=[];attrSeq=0;constructor(e={},t,n){this.events=e,this.assetUrls=n,this.targetCount=t??Math.min(100,Math.max(1,navigator.hardwareConcurrency-1)),console.debug(`[lazstream] WorkerPool: targeting`,this.targetCount,`workers`,{hardwareConcurrency:navigator.hardwareConcurrency,explicitCount:t})}async init(){let e=this.assetUrls?.workerUrl??new URL(`./decode-worker.js`,import.meta.url),t=(this.assetUrls?.lazPerfJsUrl??new URL(`./laz-perf-worker.js`,``+import.meta.url)).toString(),n=(this.assetUrls?.lazPerfWasmUrl??new URL(`./laz-perf-worker.wasm`,``+import.meta.url)).toString();return new Promise((r,i)=>{let a=setTimeout(()=>{i(Error(`Worker pool init timed out — only ${this.readyCount}/${this.targetCount} workers ready`))},15e3);for(let i=0;i<this.targetCount;i++){let o=new Worker(e,{type:`module`}),s={worker:o,busy:!1,currentChunkIndex:null,currentAttrSeqId:null};o.onmessage=e=>{let t=e.data;if(t.type===`ready`){this.readyCount++,console.debug(`[lazstream] worker ${i} ready (${this.readyCount}/${this.targetCount})`),this.readyCount===this.targetCount&&(clearTimeout(a),console.debug(`[lazstream] all ${this.targetCount} workers ready`),this.events.onReady?.(),r());return}if(t.type===`decoded`){this.handleDecoded(s,t);return}if(t.type===`error`){this.handleError(s,t);return}if(t.type===`point-attrs`){this.handlePointAttrs(s,t);return}if(t.type===`point-attrs-error`){this.handlePointAttrsError(s,t);return}},o.onerror=e=>{if(console.error(`[lazstream] worker ${i} uncaught error:`,{message:e.message,filename:e.filename,lineno:e.lineno}),s.currentAttrSeqId!==null){let t=this.pendingAttrs.get(s.currentAttrSeqId);t&&(this.pendingAttrs.delete(s.currentAttrSeqId),t.reject(Error(e.message??`uncaught worker error during attr decode`))),s.currentAttrSeqId=null}else s.currentChunkIndex!==null&&(this.inFlight.delete(s.currentChunkIndex),this.events.onWorkerError?.(s.currentChunkIndex,e.message??`uncaught worker error`));s.busy=!1,s.currentChunkIndex=null},this.workers.push(s),o.postMessage({type:`init`,lazPerfUrl:t,lazPerfWasmUrl:n})}})}configure(e,t,n){this.header=e,this.lazVlr=t,this.intensitySeedRange=n??null,console.debug(`[lazstream] WorkerPool configured:`,{pdrf:e.pointDataRecordFormat,intensitySeedRange:n??`(none)`})}requestDecode(e,t,n){if(this.disposed||this.completed.has(e)||this.inFlight.has(e))return;let r=this.workers.find(e=>!e.busy);r?this.dispatch(r,e,t,n):this.queue.some(t=>t.chunkIndex===e)||this.queue.push({chunkIndex:e,chunk:t,compressedBytes:n})}isKnown(e){return this.completed.has(e)||this.inFlight.has(e)?!0:this.queue.some(t=>t.chunkIndex===e)}markEvicted(e){this.completed.delete(e)}get activeCount(){return this.inFlight.size}get queueLength(){return this.queue.length}requestPointAttributes(e,t){return new Promise((n,r)=>{if(this.disposed){r(Error(`WorkerPool disposed`));return}if(!this.header){r(Error(`WorkerPool not configured`));return}let i=++this.attrSeq;this.pendingAttrs.set(i,{resolve:n,reject:r});let a=this.workers.find(e=>!e.busy);a?this.dispatchAttr(a,i,e,t):this.attrQueue.push({seqId:i,compressedBytes:e,pointIndex:t,resolve:n,reject:r})})}dispose(){this.disposed=!0,this.queue=[],this.attrQueue=[],this.inFlight.clear();for(let{reject:e}of this.pendingAttrs.values())e(Error(`WorkerPool disposed`));this.pendingAttrs.clear();for(let e of this.workers)e.worker.terminate();this.workers=[]}dispatch(e,t,n,r){if(!this.header||!this.lazVlr){console.error(`[lazstream] dispatch called before configure() — skipping`);return}e.busy=!0,e.currentChunkIndex=t,this.inFlight.add(t),e.worker.postMessage({type:`decode`,chunkIndex:t,compressedBytes:r,pointCount:n.pointCount,pointDataRecordFormat:this.header.pointDataRecordFormat,pointDataRecordLength:this.header.pointDataRecordLength,scaleX:this.header.scaleX,scaleY:this.header.scaleY,scaleZ:this.header.scaleZ,offsetX:this.header.offsetX,offsetY:this.header.offsetY,offsetZ:this.header.offsetZ,globalMinZ:this.header.minZ,globalMaxZ:this.header.maxZ,seedLo:this.intensitySeedRange?.lo??0,seedHi:this.intensitySeedRange?.hi??65535},[r])}handleDecoded(e,t){let n=t.chunkIndex;e.busy=!1,e.currentChunkIndex=null,this.inFlight.delete(n),this.completed.add(n),this.events.onChunkDecoded?.({chunkIndex:n,positions:t.positions,colors:t.colors,classification:t.classification,intensity8:t.intensity8,pointCount:t.pointCount,minX:t.minX,minY:t.minY,minZ:t.minZ,maxX:t.maxX,maxY:t.maxY,maxZ:t.maxZ,decodeMs:t.decodeMs??0}),this.dispatchNext(e)}handleError(e,t){let n=t.chunkIndex;e.busy=!1,e.currentChunkIndex=null,this.inFlight.delete(n),console.warn(`[lazstream] decode error chunk ${n}: ${t.message}`),this.events.onWorkerError?.(n,t.message),this.dispatchNext(e)}dispatchNext(e){if(this.disposed)return;if(this.attrQueue.length>0){let t=this.attrQueue.shift();this.dispatchAttr(e,t.seqId,t.compressedBytes,t.pointIndex);return}if(this.queue.length===0||!this.header||!this.lazVlr)return;let t=this.queue.shift();this.dispatch(e,t.chunkIndex,t.chunk,t.compressedBytes)}dispatchAttr(e,t,n,r){this.header&&(e.busy=!0,e.currentChunkIndex=null,e.currentAttrSeqId=t,e.worker.postMessage({type:`decode-attrs`,seqId:t,compressedBytes:n,pointIndex:r,pointDataRecordFormat:this.header.pointDataRecordFormat,pointDataRecordLength:this.header.pointDataRecordLength,scaleX:this.header.scaleX,scaleY:this.header.scaleY,scaleZ:this.header.scaleZ,offsetX:this.header.offsetX,offsetY:this.header.offsetY,offsetZ:this.header.offsetZ},[n]))}handlePointAttrs(e,t){let n=t.seqId;e.busy=!1,e.currentAttrSeqId=null;let r=this.pendingAttrs.get(n);r&&(this.pendingAttrs.delete(n),r.resolve({x:t.x,y:t.y,z:t.z,intensity:t.intensity,classification:t.classification,returnNumber:t.returnNumber,numberOfReturns:t.numberOfReturns,gpsTime:t.gpsTime,r:t.r,g:t.g,b:t.b})),this.dispatchNext(e)}handlePointAttrsError(e,t){let n=t.seqId;e.busy=!1,e.currentAttrSeqId=null;let r=this.pendingAttrs.get(n);r&&(this.pendingAttrs.delete(n),r.reject(Error(t.message))),this.dispatchNext(e)}};function se(e){return{x:(e.minX+e.maxX)*.5,y:(e.minY+e.maxY)*.5,z:(e.minZ+e.maxZ)*.5}}function ce(e){return Math.max(e.maxX-e.minX,e.maxY-e.minY,e.maxZ-e.minZ)}var le=10,ue=class{spatial;sseThreshold;decoded=new Set;constructor(e,t){this.spatial=e,this.sseThreshold=t??le}setDecoded(e){this.decoded.add(e)}prioritise(e,t,n=1/0){let r=this.spatial.queryFrustum(e);if(r.length===0)return[];let i=t.canvasHeight/(2*Math.tan(t.fovY*.5)),a=[];for(let e=0;e<r.length;e++){let n=r[e];if(this.decoded.has(n))continue;let o=this.spatial.getEntry(n);if(!o)continue;let s=se(o),c=s.x-t.worldX,l=s.y-t.worldY,u=s.z-t.worldZ,d=Math.sqrt(c*c+l*l+u*u),f=Math.max(d,1),p=ce(o)*i/f;p<this.sseThreshold||a.push({chunkIndex:n,sse:p})}return a.sort((e,t)=>t.sse-e.sse),n!==1/0&&a.length>n&&(a.length=n),a}allUndecoded(){return this.spatial.getAllChunkIndices().filter(e=>!this.decoded.has(e))}removeDecoded(e){this.decoded.delete(e)}},de=e(((e,t)=>{(function(n,r){typeof e==`object`&&t!==void 0?t.exports=r():typeof define==`function`&&define.amd?define(r):n.quickselect=r()})(e,(function(){function e(e,n,i,a,o){t(e,n,i||0,a||e.length-1,o||r)}function t(e,r,i,a,o){for(;a>i;){if(a-i>600){var s=a-i+1,c=r-i+1,l=Math.log(s),u=.5*Math.exp(2*l/3),d=.5*Math.sqrt(l*u*(s-u)/s)*(c-s/2<0?-1:1);t(e,r,Math.max(i,Math.floor(r-c*u/s+d)),Math.min(a,Math.floor(r+(s-c)*u/s+d)),o)}var f=e[r],p=i,m=a;for(n(e,i,r),o(e[a],f)>0&&n(e,i,a);p<m;){for(n(e,p,m),p++,m--;o(e[p],f)<0;)p++;for(;o(e[m],f)>0;)m--}o(e[i],f)===0?n(e,i,m):(m++,n(e,m,a)),m<=r&&(i=m+1),r<=m&&(a=m-1)}}function n(e,t,n){var r=e[t];e[t]=e[n],e[n]=r}function r(e,t){return e<t?-1:+(e>t)}return e}))})),fe=e((e=>{Object.defineProperty(e,"__esModule",{value:!0});var t=de(),n=[],r=function(e){return n.push(e)},i=function(e){e&&(r(e),l(e)||e.children.forEach(i))},a=function(e){var t=n.pop();return t?(t.children=e,t.height=1,t.leaf=!0,t.minX=1/0,t.minY=1/0,t.minZ=1/0,t.maxX=-1/0,t.maxY=-1/0,t.maxZ=-1/0):t={children:e,height:1,leaf:!0,minX:1/0,minY:1/0,minZ:1/0,maxX:-1/0,maxY:-1/0,maxZ:-1/0},t},o=[],s=function(e){return o.push(e)},c=function(e,t){var n=o.pop();return n?(n.dist=e,n.node=t):n={dist:e,node:t},n},l=function(e){return e.leaf},u=function(e,t){return e.leaf},d=function(e,t,n){if(!n)return t.indexOf(e);for(var r=0;r<t.length;r++)if(n(e,t[r]))return r;return-1},f=function(e){p(e,0,e.children.length,e)},p=function(e,t,n,r){var i=r;i?(i.minX=1/0,i.minY=1/0,i.minZ=1/0,i.maxX=-1/0,i.maxY=-1/0,i.maxZ=-1/0):i=a([]);for(var o=t,s=void 0;o<n;o++)s=e.children[o],m(i,s);return i},m=function(e,t){return e.minX=Math.min(e.minX,t.minX),e.minY=Math.min(e.minY,t.minY),e.minZ=Math.min(e.minZ,t.minZ),e.maxX=Math.max(e.maxX,t.maxX),e.maxY=Math.max(e.maxY,t.maxY),e.maxZ=Math.max(e.maxZ,t.maxZ),e},h=function(e){return(e.maxX-e.minX)*(e.maxY-e.minY)*(e.maxZ-e.minZ)},g=function(e){return e.maxX-e.minX+(e.maxY-e.minY)+(e.maxZ-e.minZ)},_=function(e,t){var n=Math.min(e.minX,t.minX),r=Math.min(e.minY,t.minY),i=Math.min(e.minZ,t.minZ),a=Math.max(e.maxX,t.maxX),o=Math.max(e.maxY,t.maxY),s=Math.max(e.maxZ,t.maxZ);return(a-n)*(o-r)*(s-i)},v=function(e,t){var n=Math.max(e.minX,t.minX),r=Math.max(e.minY,t.minY),i=Math.max(e.minZ,t.minZ),a=Math.min(e.maxX,t.maxX),o=Math.min(e.maxY,t.maxY),s=Math.min(e.maxZ,t.maxZ);return Math.max(0,a-n)*Math.max(0,o-r)*Math.max(0,s-i)},y=function(e,t){return e.minX<=t.minX&&e.minY<=t.minY&&e.minZ<=t.minZ&&t.maxX<=e.maxX&&t.maxY<=e.maxY&&t.maxZ<=e.maxZ};e.intersects=function(e,t){return t.minX<=e.maxX&&t.minY<=e.maxY&&t.minZ<=e.maxZ&&t.maxX>=e.minX&&t.maxY>=e.minY&&t.maxZ>=e.minZ},e.boxRayIntersects=function(e,t,n,r,i,a,o){var s=(e.minX-t)*i,c=(e.maxX-t)*i,l=(e.minY-n)*a,u=(e.maxY-n)*a,d=(e.minZ-r)*o,f=(e.maxZ-r)*o,p=Math.min(d,f),m=Math.max(d,f),h=Math.min(l,u),g=Math.max(l,u),_=Math.min(s,c),v=Math.max(s,c),y=Math.max(0,_,h,p);return Math.min(v,g,m)>=y?y:1/0};var b=function(e,n,r,i,a){for(var o=[n,r],s;o.length;)r=o.pop(),n=o.pop(),!(r-n<=i)&&(s=n+Math.ceil((r-n)/i/2)*i,t(e,s,n,r,a),o.push(n,s,s,r))},x=function(e,t){return e.minX-t.minX},S=function(e,t){return e.minY-t.minY},C=function(e,t){return e.minZ-t.minZ};e.RBush3D=function(){function t(e){e===void 0&&(e=16),this.maxEntries=Math.max(e,8),this.minEntries=Math.max(4,Math.ceil(this.maxEntries*.4)),this.clear()}return t.alloc=function(){return this.pool.pop()||new this},t.free=function(e){e.clear(),this.pool.push(e)},t.prototype.search=function(t){var n=this.data,r=[];if(!e.intersects(t,n))return r;for(var i=[];n;){for(var a=0,o=n.children.length;a<o;a++){var s=n.children[a];e.intersects(t,s)&&(u(n,s)?r.push(s):y(t,s)?this._all(s,r):i.push(s))}n=i.pop()}return r},t.prototype.collides=function(t){var n=this.data;if(!e.intersects(t,n))return!1;for(var r=[];n;){for(var i=0,a=n.children.length;i<a;i++){var o=n.children[i];if(e.intersects(t,o)){if(u(n,o)||y(t,o))return!0;r.push(o)}}n=r.pop()}return!1},t.prototype.raycastInv=function(t,n,r,i,a,o,l){l===void 0&&(l=1/0);var d=this.data;if(i===1/0&&a===1/0&&o===1/0||e.boxRayIntersects(d,t,n,r,i,a,o)===1/0)return c(1/0,void 0);for(var f=[c(0,d)],p=function(e,t){var n=f[e];f[e]=f[t],f[t]=n},m=function(){var e=f[0],t=f.length-1;f[0]=f[t],f.length=t;for(var n=0;;){var r=n<<1|1;if(r>=t)break;var i=r+1;if(i<t&&f[i].dist<f[r].dist&&(r=i),f[n].dist<f[r].dist)break;p(n,r),n=r}return s(e),e.node},h=function(e,t){var n=f.length;for(f.push(c(e,t));n>0;){var r=n-1>>1;if(f[r].dist<=f[n].dist)break;p(n,r),n=r}},g=l,_;f.length&&f[0].dist<g;){d=m();for(var v=0,y=d.children.length;v<y;v++){var b=d.children[v],x=e.boxRayIntersects(b,t,n,r,i,a,o);if(!u(d,b))h(x,b);else if(x<g){if(x===0)return c(x,b);g=x,_=b}}}return c(g<l?g:1/0,_)},t.prototype.raycast=function(e,t,n,r,i,a,o){return o===void 0&&(o=1/0),this.raycastInv(e,t,n,1/r,1/i,1/a,o)},t.prototype.all=function(){return this._all(this.data,[])},t.prototype.load=function(e){if(!(e&&e.length))return this;if(e.length<this.minEntries){for(var t=0,n=e.length;t<n;t++)this.insert(e[t]);return this}var r=this.build(e.slice(),0,e.length-1,0);if(!this.data.children.length)this.data=r;else if(this.data.height===r.height)this.splitRoot(this.data,r);else{if(this.data.height<r.height){var i=this.data;this.data=r,r=i}this._insert(r,this.data.height-r.height-1,!0)}return this},t.prototype.insert=function(e){return e&&this._insert(e,this.data.height-1),this},t.prototype.clear=function(){return this.data&&i(this.data),this.data=a([]),this},t.prototype.remove=function(e,t){if(!e)return this;for(var n=this.data,r=0,i=!1,a,o,s=[],c=[];n||s.length;){if(n||(n=s.pop(),r=c.pop(),o=s[s.length-1],i=!0),l(n)&&(a=d(e,n.children,t),a!==-1))return n.children.splice(a,1),s.push(n),this.condense(s),this;!i&&!l(n)&&y(n,e)?(s.push(n),c.push(r),r=0,o=n,n=n.children[0]):o?(r++,n=o.children[r],i=!1):n=void 0}return this},t.prototype.toJSON=function(){return this.data},t.prototype.fromJSON=function(e){return i(this.data),this.data=e,this},t.prototype.build=function(e,t,n,r){var i=n-t+1,o=this.maxEntries,s;if(i<=o)return s=a(e.slice(t,n+1)),f(s),s;r||(r=Math.ceil(Math.log(i)/Math.log(o)),o=Math.ceil(i/o**(r-1))),s=a([]),s.leaf=!1,s.height=r;var c=Math.ceil(i/o),l=c*Math.ceil(o**(2/3)),u=c*Math.ceil(o**(1/3));b(e,t,n,u,x);for(var d=t;d<=n;d+=u){var p=Math.min(d+u-1,n);b(e,d,p,l,S);for(var m=d;m<=p;m+=l){var h=Math.min(m+l-1,p);b(e,m,h,c,C);for(var g=m;g<=h;g+=c){var _=Math.min(g+c-1,h);s.children.push(this.build(e,g,_,r-1))}}}return f(s),s},t.prototype._all=function(e,t){for(var n=[];e;)l(e)?t.push.apply(t,e.children):n.push.apply(n,e.children),e=n.pop();return t},t.prototype.chooseSubtree=function(e,t,n,r){for(var i,a,o;r.push(t),!(l(t)||r.length-1===n);){i=a=1/0;for(var s=0,c=t.children.length;s<c;s++){var u=t.children[s],d=h(u),f=_(e,u)-d;f<a?(a=f,i=d<i?d:i,o=u):f===a&&d<i&&(i=d,o=u)}t=o||t.children[0]}return t},t.prototype.split=function(e,t){var n=e[t],r=n.children.length,i=this.minEntries;this.chooseSplitAxis(n,i,r);var o=this.chooseSplitIndex(n,i,r),s=a(n.children.splice(o,n.children.length-o));s.height=n.height,s.leaf=n.leaf,f(n),f(s),t?e[t-1].children.push(s):this.splitRoot(n,s)},t.prototype.splitRoot=function(e,t){this.data=a([e,t]),this.data.height=e.height+1,this.data.leaf=!1,f(this.data)},t.prototype.chooseSplitIndex=function(e,t,n){for(var r=1/0,i=1/0,a,o=t;o<=n-t;o++){var s=p(e,0,o),c=p(e,o,n),l=v(s,c),u=h(s)+h(c);l<r?(r=l,a=o,i=u<i?u:i):l===r&&u<i&&(i=u,a=o)}return a},t.prototype.chooseSplitAxis=function(e,t,n){var r=this.allDistMargin(e,t,n,x),i=this.allDistMargin(e,t,n,S),a=this.allDistMargin(e,t,n,C);r<i&&r<a?e.children.sort(x):i<r&&i<a&&e.children.sort(S)},t.prototype.allDistMargin=function(e,t,n,r){e.children.sort(r);for(var i=p(e,0,t),a=p(e,n-t,n),o=g(i)+g(a),s=t;s<n-t;s++){var c=e.children[s];m(i,c),o+=g(i)}for(var s=n-t-1;s>=t;s--){var c=e.children[s];m(a,c),o+=g(a)}return o},t.prototype.adjustParentBBoxes=function(e,t,n){for(var r=n;r>=0;r--)m(t[r],e)},t.prototype.condense=function(e){for(var t=e.length-1,n=void 0;t>=0;t--)e[t].children.length===0?t>0?(n=e[t-1].children,n.splice(n.indexOf(e[t]),1),r(e[t])):this.clear():f(e[t])},t.prototype._insert=function(e,t,n){var r=[],i=this.chooseSubtree(e,this.data,t,r);for(i.children.push(e),m(i,e);t>=0&&r[t].children.length>this.maxEntries;)this.split(r,t),t--;this.adjustParentBBoxes(e,r,t)},t.pool=[],t}()}))(),pe=class{tree;byIndex=new Map;constructor(){this.tree=new fe.RBush3D(16)}buildFromSeeds(e,t){if(this.tree.clear(),this.byIndex.clear(),e.length===0)return;let n=Math.max(1,(t.maxX-t.minX)*(t.maxY-t.minY)),r=Math.sqrt(n/e.length)*1.5*.5,i=(t.maxZ-t.minZ)*.5,a=e.map(e=>({minX:e.x-r,minY:e.y-r,minZ:e.z-i,maxX:e.x+r,maxY:e.y+r,maxZ:e.z+i,chunkIndex:e.chunkIndex,tight:!1}));for(let e of a)this.byIndex.set(e.chunkIndex,e);this.tree.load(a)}updateFromDecoded(e){let t=this.byIndex.get(e.chunkIndex);if(!t||t.tight)return;this.tree.remove(t);let n={minX:e.minX,minY:e.minY,minZ:e.minZ,maxX:e.maxX,maxY:e.maxY,maxZ:e.maxZ,chunkIndex:e.chunkIndex,tight:!0};this.tree.insert(n),this.byIndex.set(e.chunkIndex,n)}queryFrustum(e){let t=this.tree.search(e),n=Array(t.length);for(let e=0;e<t.length;e++)n[e]=t[e].chunkIndex;return n}getAllChunkIndices(){return Array.from(this.byIndex.keys())}getEntry(e){let t=this.byIndex.get(e);if(t)return{minX:t.minX,minY:t.minY,minZ:t.minZ,maxX:t.maxX,maxY:t.maxY,maxZ:t.maxZ,chunkIndex:t.chunkIndex,tight:t.tight}}size(){return this.byIndex.size}clear(){this.tree.clear(),this.byIndex.clear()}};function me(e,t,n){return`${he(e)}:${t}:${n}`}function he(e){let t=2166136261;for(let n=0;n<e.length;n++)t^=e.charCodeAt(n),t=Math.imul(t,16777619);return(t>>>0).toString(36)}function ge(e){return e instanceof Error&&e.name===`AbortError`}var _e=class{events;workerPool=null;prioritiser=null;spatial=new pe;chunks=[];header=null;url=``;decodedPointCount=0;decodedChunkCount=0;fileSize=0;cameraInfoProvider=null;frustumProvider=null;ringBufferProvider=null;cache=null;workerCount;sseThreshold;assetUrls;workersConfigured=!1;abortController=null;fetching=new Set;maxFetches;constructor(e={}){let{events:t={},workerCount:n,cache:r,sseThreshold:i,maxFetches:a,assetUrls:o}=e;this.events=t,this.workerCount=n??Math.min(100,Math.max(1,navigator.hardwareConcurrency-1)),this.maxFetches=a??Math.min(this.workerCount*4,128),this.cache=r??null,this.sseThreshold=i,this.assetUrls=o,console.debug(`[lazstream] StreamingEngine:`,{workerCount:this.workerCount,maxFetches:this.maxFetches,cacheEnabled:this.cache!==null,sseThreshold:this.sseThreshold??`(default)`})}setCameraProvider(e){this.cameraInfoProvider=e}setFrustumProvider(e){this.frustumProvider=e}setRingBufferProvider(e){this.ringBufferProvider=e}onChunkEvictedFromGPU(e){this.prioritiser?.removeDecoded(e),this.workerPool?.markEvicted(e)}async load(e){this.abortController?.abort(),this.workerPool?.dispose(),this.workerPool=null,this.workersConfigured=!1,this.spatial.clear(),this.prioritiser=null,this.chunks=[],this.header=null,this.url=``,this.decodedPointCount=0,this.decodedChunkCount=0,this.fileSize=0,this.fetching=new Set,this.abortController=new AbortController;let r=this.abortController.signal;try{this.emit(`probing`,`Validating URL...`);let i=c(e);this.url=i.toString(),this.emit(`probing`,`Checking file accessibility...`);let{fileSize:a,supportsRange:o}=await m(this.url,r);if(this.fileSize=a,!o)throw Error(`This server does not support HTTP Range requests. lazstream requires Range support to stream point clouds.`);if(a===0)throw Error(`Could not determine file size.`);this.emit(`header`,`Reading file header...`);let{header:s,lazVlr:l}=await C(this.url,r);this.header=s;let u=t(s,l),d=n(u);if(d&&this.events.onWarning?.(d),u===`unsupported`)throw new y(`This file cannot be displayed.`);this.emitStats(),this.emit(`chunk-table`,`Reading chunk index...`),this.chunks=await ie(this.url,s,l,a,r),this.emitStats(),this.emit(`seeds`,`Fetching ${this.chunks.length} chunk seed points...`);let f=await ae(this.url,this.chunks,s,l,(e,t)=>this.events.onProgress?.(e,t,`seeds`),r);this.events.onSeedsReady?.(f,s),this.buildSpatialIndex(f,s);let p=ve(f);if(console.debug(`[lazstream] intensity seed range:`,p),this.emit(`workers-init`,`Starting ${this.workerCount} decode workers...`),this.workerPool=new oe({onChunkDecoded:e=>this.handleChunkDecoded(e),onWorkerError:(e,t)=>{console.warn(`[lazstream] chunk ${e} decode failed: ${t}`)},onReady:()=>{console.debug(`[lazstream] worker pool ready`)}},this.workerCount,this.assetUrls),await this.workerPool.init(),r.aborted)throw new DOMException(`Load aborted during worker init`,`AbortError`);this.workerPool.configure(s,l,p),this.workersConfigured=!0,this.emit(`streaming`,`Streaming — ${this.workerCount} workers active`)}catch(e){if(ge(e)){console.debug(`[lazstream] load cancelled`);return}let t=e instanceof Error?e:Error(String(e));this.events.onStateChange?.(`error`,t.message),this.events.onError?.(t)}}updateCamera(){if(!this.prioritiser||!this.workerPool||!this.workersConfigured||!this.cameraInfoProvider||!this.frustumProvider)return;let e=2**53-1,t=2**53-1;if(this.ringBufferProvider){t=this.ringBufferProvider().slotsFree;let n=this.fetching.size+this.workerPool.queueLength+this.workerPool.activeCount;e=Math.max(0,t-n)}let n=this.maxFetches-this.fetching.size,r=Math.min(this.workerCount,Math.max(1,navigator.hardwareConcurrency-1)),i=this.workerPool.queueLength+this.workerPool.activeCount<r&&t>0?n:Math.min(e,n);if(i<=0)return;let a=this.cameraInfoProvider(),o=this.frustumProvider(),s=this.prioritiser.prioritise(o,a,i);if(s.length===0)return;let c=[];for(let e of s){if(this.fetching.has(e.chunkIndex)||this.workerPool.isKnown(e.chunkIndex))continue;let t=this.chunks[e.chunkIndex];t&&(c.push({chunkIndex:e.chunkIndex,chunk:t}),this.fetching.add(e.chunkIndex))}c.length!==0&&this.dispatchCandidates(c)}decodeAll(){if(!this.workerPool||!this.prioritiser||!this.workersConfigured)return;let e=this.prioritiser.allUndecoded();e.length>200&&console.warn(`[lazstream] decodeAll: ${e.length} chunks — bypasses fetch cap and ring-buffer back-pressure. Use only for stress testing.`);let t=[];for(let n of e){if(this.fetching.has(n)||this.workerPool.isKnown(n))continue;let e=this.chunks[n];e&&(t.push({chunkIndex:n,chunk:e}),this.fetching.add(n))}t.length!==0&&this.dispatchCandidates(t)}get chunkCount(){return this.chunks.length}async resolvePointAttributes(e,t){let n=this.chunks[e];if(!n||!this.workerPool||!this.header)return null;let r=null,i=!1;if(this.cache&&(r=await this.cache.get(me(this.url,e,n.offset)),i=r!==null),!r)try{r=await p(this.url,n.offset,n.offset+n.compressedSize-1,this.abortController?.signal)}catch(e){return ge(e)||console.warn(`[lazstream] T3 fetch failed:`,e),null}!i&&this.cache&&this.cache.set(me(this.url,e,n.offset),r.slice(0));try{return await this.workerPool.requestPointAttributes(r,t)}catch(e){return console.warn(`[lazstream] T3 decode failed:`,e),null}}dispose(){this.abortController?.abort(),this.abortController=null,this.workerPool?.dispose(),this.workerPool=null,this.spatial.clear(),this.prioritiser=null,this.cameraInfoProvider=null,this.frustumProvider=null,this.ringBufferProvider=null,this.workersConfigured=!1}async dispatchCandidates(e){let t=this.url,n=this.abortController?.signal,r=this.workerPool,i=this.fetching,a=this.cache;if(!n||!r){for(let t of e)i.delete(t.chunkIndex);return}try{let o;if(o=a?await Promise.all(e.map(async e=>({chunkIndex:e.chunkIndex,chunk:e.chunk,cached:await a.get(me(t,e.chunkIndex,e.chunk.offset))}))):e.map(e=>({chunkIndex:e.chunkIndex,chunk:e.chunk,cached:null})),n.aborted)return;let s=[];for(let e of o)e.cached?(r.requestDecode(e.chunkIndex,e.chunk,e.cached),i.delete(e.chunkIndex)):s.push({chunkIndex:e.chunkIndex,chunk:e.chunk});if(s.length===0)return;let c=h(s);await Promise.all(c.map(e=>this.fetchAndDispatchBatch(e,t,n,r,a,i)))}catch(e){ge(e)||console.warn(`[lazstream] dispatch error:`,e)}finally{for(let t of e)i.delete(t.chunkIndex)}}async fetchAndDispatchBatch(e,t,n,r,i,a){if(e.chunks.length!==0)try{let o=performance.now(),s=await p(t,e.start,e.end-1,n),c=performance.now()-o;if(n.aborted)return;let l=(e.end-e.start)/1048576;console.debug(`[lazstream/timing] fetch ${e.chunks.length} chunks ${l.toFixed(2)} MB in ${c.toFixed(0)} ms (${(l*1e3/c).toFixed(1)} MB/s)`);for(let n of e.chunks){let o=n.chunk.offset-e.start,c=s.slice(o,o+n.chunk.compressedSize);if(i){let e=c.slice(0);i.set(me(t,n.chunkIndex,n.chunk.offset),e)}r.requestDecode(n.chunkIndex,n.chunk,c),a.delete(n.chunkIndex)}}catch(t){ge(t)||console.warn(`[lazstream] batch fetch failed (bytes ${e.start}-${e.end-1}, ${e.chunks.length} chunks):`,t);for(let t of e.chunks)a.delete(t.chunkIndex)}}buildSpatialIndex(e,t){let n={minX:t.minX,maxX:t.maxX,minY:t.minY,maxY:t.maxY,minZ:t.minZ,maxZ:t.maxZ},r=e.map(e=>({chunkIndex:e.chunkIndex,x:e.x,y:e.y,z:e.z}));this.spatial.buildFromSeeds(r,n),this.prioritiser=new ue(this.spatial,this.sseThreshold)}handleChunkDecoded(e){this.spatial.updateFromDecoded({chunkIndex:e.chunkIndex,minX:e.minX,minY:e.minY,minZ:e.minZ,maxX:e.maxX,maxY:e.maxY,maxZ:e.maxZ}),this.prioritiser?.setDecoded(e.chunkIndex),this.decodedChunkCount++,this.decodedPointCount+=e.pointCount,this.events.onChunkDecoded?.(e),this.emitStats(),this.events.onProgress?.(this.decodedChunkCount,this.chunks.length,`decode`),this.decodedChunkCount>=this.chunks.length&&this.emit(`ready`,`Ready`)}emit(e,t){this.events.onStateChange?.(e,t)}emitStats(){this.header&&this.events.onStats?.({fileSize:this.fileSize,pointCount:this.header.pointCount,chunkCount:this.chunks.length,version:`LAS ${this.header.versionMajor}.${this.header.versionMinor}`,format:this.header.pointDataRecordFormat,decodedChunks:this.decodedChunkCount,decodedPoints:this.decodedPointCount,activeWorkers:this.workerPool?.activeCount??0,queuedChunks:this.workerPool?.queueLength??0})}};function ve(e){if(e.length===0)return{lo:0,hi:65535};let t=e.map(e=>e.intensity).sort((e,t)=>e-t),n=t.length,r=t[Math.floor(.01*n)]??0,i=t[Math.floor(.99*n)]??65535;return{lo:r,hi:i<=r?r+1:i}}var ye=class{manifest;options;engines=[];offsets=[];cameraProvider=null;frustumProvider=null;ringBufferProvider=null;constructor(e,t){this.manifest=e,this.options=t}setCameraProvider(e){this.cameraProvider=e;for(let t of this.engines)t.setCameraProvider(e)}setFrustumProvider(e){this.frustumProvider=e;for(let t of this.engines)t.setFrustumProvider(e)}setRingBufferProvider(e){this.ringBufferProvider=e;for(let t of this.engines)t.setRingBufferProvider(e)}onChunkEvictedFromGPU(e){let{engine:t,localIndex:n}=this.resolveGlobalIndex(e);t?.onChunkEvictedFromGPU(n)}updateCamera(){for(let e of this.engines)e.updateCamera()}async resolvePointAttributes(e,t){let{engine:n,localIndex:r}=this.resolveGlobalIndex(e);return n?n.resolvePointAttributes(r,t):null}dispose(){for(let e of this.engines)e.dispose();this.engines=[],this.offsets=[]}async load(){let{tiles:e}=this.manifest,{events:t,workerCount:n,sseThreshold:r,maxFetches:i,cache:a,assetUrls:o}=this.options,s=e.length,c=Math.min(100,Math.max(1,navigator.hardwareConcurrency-1)),l=Math.max(1,Math.floor((n??c)/s)),u=Array(s).fill(null),d=Array(s).fill(null),f=0,p=0,m={streamingTiles:new Set,readyTiles:new Set,perTileStats:Array(s).fill(null)},h=()=>{if(f<s)return;if(p===0){t.onError?.(Error(`All manifest tiles failed to load.`));return}let e=0;for(let t=0;t<s;t++)this.offsets[t]=e,e+=this.engines[t]?.chunkCount??0;let n=[],r=[];for(let e=0;e<s;e++){let t=u[e],i=d[e];if(!t||!i)continue;let a=this.offsets[e];for(let e of t)n.push({...e,chunkIndex:e.chunkIndex+a});r.push(i)}let i=xe(r);t.onSeedsReady?.(n,i)};for(let n=0;n<s;n++){let c=e[n].url,g=n,_=new _e({events:this.makeTileEvents(g,c,s,t,m,()=>{p++,f++,h()},()=>{f++,h()},u,d),workerCount:l,cache:a,sseThreshold:r,maxFetches:i,assetUrls:o});this.cameraProvider&&_.setCameraProvider(this.cameraProvider),this.frustumProvider&&_.setFrustumProvider(this.frustumProvider),this.ringBufferProvider&&_.setRingBufferProvider(this.ringBufferProvider),this.engines.push(_),this.offsets.push(0)}await Promise.all(e.map((e,t)=>this.engines[t].load(e.url)))}makeTileEvents(e,t,n,r,i,a,o,s,c){let l=n>1;return{onStateChange:(t,a)=>{if(!l){r.onStateChange?.(t,a);return}if(t===`streaming`){let t=i.streamingTiles.size;i.streamingTiles.add(e),i.streamingTiles.size!==t&&r.onStateChange?.(`streaming`,`Streaming ${i.streamingTiles.size}/${n} tiles`);return}if(t===`ready`){i.readyTiles.add(e);let t=i.readyTiles.size;t===n?r.onStateChange?.(`ready`,n>1?`${n} tiles loaded`:`Ready`):r.onStateChange?.(`streaming`,`${t}/${n} tiles ready`);return}e===0&&r.onStateChange?.(t,a)},onWarning:r.onWarning,onProgress:r.onProgress,onStats:t=>{if(!l){r.onStats?.(t);return}i.perTileStats[e]=t;let n=be(i.perTileStats);n&&r.onStats?.(n)},onSeedsReady:(t,n)=>{s[e]=t,c[e]=n,a()},onChunkDecoded:t=>{let n=this.offsets[e]??0;r.onChunkDecoded?.({...t,chunkIndex:t.chunkIndex+n})},onError:n=>{r.onWarning?.(`Tile ${e+1} failed to load (${t}): ${n.message}`),o()}}}resolveGlobalIndex(e){for(let t=this.offsets.length-1;t>=0;t--)if(e>=this.offsets[t])return{engine:this.engines[t],localIndex:e-this.offsets[t]};return{engine:null,localIndex:e}}};function be(e){let t=e.filter(e=>e!==null);if(t.length===0)return null;let n=t[0];return{fileSize:t.reduce((e,t)=>e+t.fileSize,0),pointCount:t.reduce((e,t)=>e+t.pointCount,0),chunkCount:t.reduce((e,t)=>e+t.chunkCount,0),version:n.version,format:n.format,decodedChunks:t.reduce((e,t)=>e+(t.decodedChunks??0),0),decodedPoints:t.reduce((e,t)=>e+(t.decodedPoints??0),0),activeWorkers:t.reduce((e,t)=>e+(t.activeWorkers??0),0),queuedChunks:t.reduce((e,t)=>e+(t.queuedChunks??0),0)}}function xe(e){if(e.length===0)throw Error(`ManifestSession: no valid headers to merge`);let t={...e[0]};return t.minX=Math.min(...e.map(e=>e.minX)),t.minY=Math.min(...e.map(e=>e.minY)),t.minZ=Math.min(...e.map(e=>e.minZ)),t.maxX=Math.max(...e.map(e=>e.maxX)),t.maxY=Math.max(...e.map(e=>e.maxY)),t.maxZ=Math.max(...e.map(e=>e.maxZ)),t.pointCount=e.reduce((e,t)=>e+t.pointCount,0),t}var A=class extends Error{constructor(e){super(e),this.name=`ManifestParseError`}};async function Se(e,t){let n;try{n=await fetch(e,{signal:t,cache:`no-store`,headers:{Accept:`application/json`}})}catch(e){throw e instanceof Error&&e.name===`AbortError`?e:new d(`Manifest fetch failed: ${e instanceof Error?e.message:String(e)}`)}if(!n.ok)throw new d(`Manifest fetch failed: ${n.status} ${n.statusText} (${e})`);let r;try{r=await n.json()}catch{throw new A(`Manifest is not valid JSON (${e})`)}return Ce(r)}function Ce(e){if(typeof e!=`object`||!e||Array.isArray(e))throw new A(`Manifest must be a JSON object`);let t=e;if(t.version!==`1.0`)throw new A(`Unsupported manifest version "${t.version}". This viewer supports version "1.0" only.`);if(!Array.isArray(t.tiles)||t.tiles.length===0)throw new A(`Manifest "tiles" must be a non-empty array`);let n=1e4;if(t.tiles.length>n)throw new A(`Manifest contains ${t.tiles.length} tiles — maximum is ${n}.`);return{version:`1.0`,tiles:t.tiles.map((e,t)=>Te(e,t)),name:De(t,`name`),attribution:De(t,`attribution`),srs:De(t,`srs`)}}function we(e){return{version:`1.0`,tiles:[{url:e}]}}function Te(e,t){let n=`Manifest tile[${t}]`;if(typeof e!=`object`||!e||Array.isArray(e))throw new A(`${n} must be an object`);let r=e;if(typeof r.url!=`string`||r.url.trim()===``)throw new A(`${n} must have a non-empty "url" string`);let i={url:r.url.trim()};if(`bounds`in r&&r.bounds!==void 0){let e=r.bounds;if(typeof e!=`object`||!e)throw new A(`${n} "bounds" must be an object`);i.bounds={min:Ee(e.min,`${n} bounds.min`),max:Ee(e.max,`${n} bounds.max`)}}if(`points`in r&&r.points!==void 0){let e=r.points;if(typeof e!=`number`||!Number.isFinite(e)||e<=0)throw new A(`${n} "points" must be a positive finite number`);i.points=e}let a=De(r,`srs`);return a!==void 0&&(i.srs=a),i}function Ee(e,t){if(!Array.isArray(e)||e.length!==3||!e.every(e=>typeof e==`number`&&Number.isFinite(e)))throw new A(`${t} must be an array of 3 finite numbers`);return[e[0],e[1],e[2]]}function De(e,t){let n=e[t];if(n!==void 0){if(typeof n!=`string`||n.trim()===``)throw new A(`Manifest "${t}" must be a non-empty string if present`);return n.trim()}}var Oe=class extends Error{constructor(e){super(e),this.name=`ViewStateDecodeError`}};function ke(e){let t=JSON.stringify(e),n=new TextEncoder().encode(t);return btoa(String.fromCharCode(...n)).replace(/\+/g,`-`).replace(/\//g,`_`).replace(/=+$/,``)}function Ae(e){let t;try{let n=e.replace(/-/g,`+`).replace(/_/g,`/`);t=atob(n)}catch{throw new Oe(`Invalid base64url in #v= token`)}let n;try{n=JSON.parse(t)}catch{throw new Oe(`Decoded #v= token is not valid JSON`)}return je(n),n}function je(e){if(typeof e!=`object`||!e)throw new Oe(`View state must be a JSON object`);let t=e;if(typeof t.source!=`string`||t.source.trim()===``)throw new Oe(`View state "source" must be a non-empty string`);let n=t.cam;if(typeof n!=`object`||!n)throw new Oe(`View state "cam" must be an object`);let r=n;for(let e of[`x`,`y`,`z`,`tx`,`ty`,`tz`,`fovY`])if(typeof r[e]!=`number`||!Number.isFinite(r[e]))throw new Oe(`View state cam.${e} must be a finite number`)}var Me={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},Ne={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},Pe=1e3,Fe=1001,Ie=1002,Le=1006,Re=1008,ze=1009,Be=1023,Ve=2300,He=2301,Ue=2302,We=2400,Ge=2401,Ke=2402,qe=`srgb`,Je=`srgb-linear`,Ye=`display-p3`,Xe=`display-p3-linear`,Ze=`linear`,Qe=`srgb`,$e=`rec709`,et=2e3,tt=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;let n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;let n=this._listeners[e];if(n!==void 0){let e=n.indexOf(t);e!==-1&&n.splice(e,1)}}dispatchEvent(e){if(this._listeners===void 0)return;let t=this._listeners[e.type];if(t!==void 0){e.target=this;let n=t.slice(0);for(let t=0,r=n.length;t<r;t++)n[t].call(this,e);e.target=null}}},j=`00.01.02.03.04.05.06.07.08.09.0a.0b.0c.0d.0e.0f.10.11.12.13.14.15.16.17.18.19.1a.1b.1c.1d.1e.1f.20.21.22.23.24.25.26.27.28.29.2a.2b.2c.2d.2e.2f.30.31.32.33.34.35.36.37.38.39.3a.3b.3c.3d.3e.3f.40.41.42.43.44.45.46.47.48.49.4a.4b.4c.4d.4e.4f.50.51.52.53.54.55.56.57.58.59.5a.5b.5c.5d.5e.5f.60.61.62.63.64.65.66.67.68.69.6a.6b.6c.6d.6e.6f.70.71.72.73.74.75.76.77.78.79.7a.7b.7c.7d.7e.7f.80.81.82.83.84.85.86.87.88.89.8a.8b.8c.8d.8e.8f.90.91.92.93.94.95.96.97.98.99.9a.9b.9c.9d.9e.9f.a0.a1.a2.a3.a4.a5.a6.a7.a8.a9.aa.ab.ac.ad.ae.af.b0.b1.b2.b3.b4.b5.b6.b7.b8.b9.ba.bb.bc.bd.be.bf.c0.c1.c2.c3.c4.c5.c6.c7.c8.c9.ca.cb.cc.cd.ce.cf.d0.d1.d2.d3.d4.d5.d6.d7.d8.d9.da.db.dc.dd.de.df.e0.e1.e2.e3.e4.e5.e6.e7.e8.e9.ea.eb.ec.ed.ee.ef.f0.f1.f2.f3.f4.f5.f6.f7.f8.f9.fa.fb.fc.fd.fe.ff`.split(`.`),nt=1234567,rt=Math.PI/180,it=180/Math.PI;function at(){let e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0,r=Math.random()*4294967295|0;return(j[e&255]+j[e>>8&255]+j[e>>16&255]+j[e>>24&255]+`-`+j[t&255]+j[t>>8&255]+`-`+j[t>>16&15|64]+j[t>>24&255]+`-`+j[n&63|128]+j[n>>8&255]+`-`+j[n>>16&255]+j[n>>24&255]+j[r&255]+j[r>>8&255]+j[r>>16&255]+j[r>>24&255]).toLowerCase()}function M(e,t,n){return Math.max(t,Math.min(n,e))}function ot(e,t){return(e%t+t)%t}function st(e,t,n,r,i){return r+(e-t)*(i-r)/(n-t)}function ct(e,t,n){return e===t?0:(n-e)/(t-e)}function lt(e,t,n){return(1-n)*e+n*t}function ut(e,t,n,r){return lt(e,t,1-Math.exp(-n*r))}function dt(e,t=1){return t-Math.abs(ot(e,t*2)-t)}function ft(e,t,n){return e<=t?0:e>=n?1:(e=(e-t)/(n-t),e*e*(3-2*e))}function pt(e,t,n){return e<=t?0:e>=n?1:(e=(e-t)/(n-t),e*e*e*(e*(e*6-15)+10))}function mt(e,t){return e+Math.floor(Math.random()*(t-e+1))}function ht(e,t){return e+Math.random()*(t-e)}function gt(e){return e*(.5-Math.random())}function _t(e){e!==void 0&&(nt=e);let t=nt+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function vt(e){return e*rt}function yt(e){return e*it}function bt(e){return(e&e-1)==0&&e!==0}function xt(e){return 2**Math.ceil(Math.log(e)/Math.LN2)}function St(e){return 2**Math.floor(Math.log(e)/Math.LN2)}function Ct(e,t,n,r,i){let a=Math.cos,o=Math.sin,s=a(n/2),c=o(n/2),l=a((t+r)/2),u=o((t+r)/2),d=a((t-r)/2),f=o((t-r)/2),p=a((r-t)/2),m=o((r-t)/2);switch(i){case`XYX`:e.set(s*u,c*d,c*f,s*l);break;case`YZY`:e.set(c*f,s*u,c*d,s*l);break;case`ZXZ`:e.set(c*d,c*f,s*u,s*l);break;case`XZX`:e.set(s*u,c*m,c*p,s*l);break;case`YXY`:e.set(c*p,s*u,c*m,s*l);break;case`ZYZ`:e.set(c*m,c*p,s*u,s*l);break;default:console.warn(`THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: `+i)}}function wt(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return e/4294967295;case Uint16Array:return e/65535;case Uint8Array:return e/255;case Int32Array:return Math.max(e/2147483647,-1);case Int16Array:return Math.max(e/32767,-1);case Int8Array:return Math.max(e/127,-1);default:throw Error(`Invalid component type.`)}}function Tt(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return Math.round(e*4294967295);case Uint16Array:return Math.round(e*65535);case Uint8Array:return Math.round(e*255);case Int32Array:return Math.round(e*2147483647);case Int16Array:return Math.round(e*32767);case Int8Array:return Math.round(e*127);default:throw Error(`Invalid component type.`)}}var Et={DEG2RAD:rt,RAD2DEG:it,generateUUID:at,clamp:M,euclideanModulo:ot,mapLinear:st,inverseLerp:ct,lerp:lt,damp:ut,pingpong:dt,smoothstep:ft,smootherstep:pt,randInt:mt,randFloat:ht,randFloatSpread:gt,seededRandom:_t,degToRad:vt,radToDeg:yt,isPowerOfTwo:bt,ceilPowerOfTwo:xt,floorPowerOfTwo:St,setQuaternionFromProperEuler:Ct,normalize:Tt,denormalize:wt},N=class e{constructor(t=0,n=0){e.prototype.isVector2=!0,this.x=t,this.y=n}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw Error(`index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw Error(`index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6],this.y=r[1]*t+r[4]*n+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(M(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),r=Math.sin(t),i=this.x-e.x,a=this.y-e.y;return this.x=i*n-a*r+e.x,this.y=i*r+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},P=class e{constructor(t,n,r,i,a,o,s,c,l){e.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,n,r,i,a,o,s,c,l)}set(e,t,n,r,i,a,o,s,c){let l=this.elements;return l[0]=e,l[1]=r,l[2]=o,l[3]=t,l[4]=i,l[5]=s,l[6]=n,l[7]=a,l[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[3],s=n[6],c=n[1],l=n[4],u=n[7],d=n[2],f=n[5],p=n[8],m=r[0],h=r[3],g=r[6],_=r[1],v=r[4],y=r[7],b=r[2],x=r[5],S=r[8];return i[0]=a*m+o*_+s*b,i[3]=a*h+o*v+s*x,i[6]=a*g+o*y+s*S,i[1]=c*m+l*_+u*b,i[4]=c*h+l*v+u*x,i[7]=c*g+l*y+u*S,i[2]=d*m+f*_+p*b,i[5]=d*h+f*v+p*x,i[8]=d*g+f*y+p*S,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8];return t*a*l-t*o*c-n*i*l+n*o*s+r*i*c-r*a*s}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=l*a-o*c,d=o*s-l*i,f=c*i-a*s,p=t*u+n*d+r*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let m=1/p;return e[0]=u*m,e[1]=(r*c-l*n)*m,e[2]=(o*n-r*a)*m,e[3]=d*m,e[4]=(l*t-r*s)*m,e[5]=(r*i-o*t)*m,e[6]=f*m,e[7]=(n*s-c*t)*m,e[8]=(a*t-n*i)*m,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,r,i,a,o){let s=Math.cos(i),c=Math.sin(i);return this.set(n*s,n*c,-n*(s*a+c*o)+a+e,-r*c,r*s,-r*(-c*a+s*o)+o+t,0,0,1),this}scale(e,t){return this.premultiply(Dt.makeScale(e,t)),this}rotate(e){return this.premultiply(Dt.makeRotation(-e)),this}translate(e,t){return this.premultiply(Dt.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<9;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Dt=new P;function Ot(e){return document.createElementNS(`http://www.w3.org/1999/xhtml`,e)}var kt=new P().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),At=new P().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),jt={[Je]:{transfer:Ze,primaries:$e,luminanceCoefficients:[.2126,.7152,.0722],toReference:e=>e,fromReference:e=>e},[qe]:{transfer:Qe,primaries:$e,luminanceCoefficients:[.2126,.7152,.0722],toReference:e=>e.convertSRGBToLinear(),fromReference:e=>e.convertLinearToSRGB()},[Xe]:{transfer:Ze,primaries:`p3`,luminanceCoefficients:[.2289,.6917,.0793],toReference:e=>e.applyMatrix3(At),fromReference:e=>e.applyMatrix3(kt)},[Ye]:{transfer:Qe,primaries:`p3`,luminanceCoefficients:[.2289,.6917,.0793],toReference:e=>e.convertSRGBToLinear().applyMatrix3(At),fromReference:e=>e.applyMatrix3(kt).convertLinearToSRGB()}},Mt=new Set([Je,Xe]),F={enabled:!0,_workingColorSpace:Je,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(e){if(!Mt.has(e))throw Error(`Unsupported working color space, "${e}".`);this._workingColorSpace=e},convert:function(e,t,n){if(this.enabled===!1||t===n||!t||!n)return e;let r=jt[t].toReference,i=jt[n].fromReference;return i(r(e))},fromWorkingColorSpace:function(e,t){return this.convert(e,this._workingColorSpace,t)},toWorkingColorSpace:function(e,t){return this.convert(e,t,this._workingColorSpace)},getPrimaries:function(e){return jt[e].primaries},getTransfer:function(e){return e===``?Ze:jt[e].transfer},getLuminanceCoefficients:function(e,t=this._workingColorSpace){return e.fromArray(jt[t].luminanceCoefficients)}};function Nt(e){return e<.04045?e*.0773993808:(e*.9478672986+.0521327014)**2.4}function Pt(e){return e<.0031308?e*12.92:1.055*e**.41666-.055}var Ft,It=class{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>`u`)return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{Ft===void 0&&(Ft=Ot(`canvas`)),Ft.width=e.width,Ft.height=e.height;let n=Ft.getContext(`2d`);e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=Ft}return t.width>2048||t.height>2048?(console.warn(`THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons`,e),t.toDataURL(`image/jpeg`,.6)):t.toDataURL(`image/png`)}static sRGBToLinear(e){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap){let t=Ot(`canvas`);t.width=e.width,t.height=e.height;let n=t.getContext(`2d`);n.drawImage(e,0,0,e.width,e.height);let r=n.getImageData(0,0,e.width,e.height),i=r.data;for(let e=0;e<i.length;e++)i[e]=Nt(i[e]/255)*255;return n.putImageData(r,0,0),t}else if(e.data){let t=e.data.slice(0);for(let e=0;e<t.length;e++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[e]=Math.floor(Nt(t[e]/255)*255):t[e]=Nt(t[e]);return{data:t,width:e.width,height:e.height}}else return console.warn(`THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied.`),e}},Lt=0,Rt=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Lt++}),this.uuid=at(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:``},r=this.data;if(r!==null){let e;if(Array.isArray(r)){e=[];for(let t=0,n=r.length;t<n;t++)r[t].isDataTexture?e.push(zt(r[t].image)):e.push(zt(r[t]))}else e=zt(r);n.url=e}return t||(e.images[this.uuid]=n),n}};function zt(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap?It.getDataURL(e):e.data?{data:Array.from(e.data),width:e.width,height:e.height,type:e.data.constructor.name}:(console.warn(`THREE.Texture: Unable to serialize Texture.`),{})}var Bt=0,Vt=class e extends tt{constructor(t=e.DEFAULT_IMAGE,n=e.DEFAULT_MAPPING,r=Fe,i=Fe,a=Le,o=Re,s=Be,c=ze,l=e.DEFAULT_ANISOTROPY,u=``){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Bt++}),this.uuid=at(),this.name=``,this.source=new Rt(t),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=r,this.wrapT=i,this.magFilter=a,this.minFilter=o,this.anisotropy=l,this.format=s,this.internalFormat=null,this.type=c,this.offset=new N(0,0),this.repeat=new N(1,1),this.center=new N(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new P,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.6,type:`Texture`,generator:`Texture.toJSON`},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:`dispose`})}transformUv(e){if(this.mapping!==300)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Pe:e.x-=Math.floor(e.x);break;case Fe:e.x=e.x<0?0:1;break;case Ie:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x-=Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Pe:e.y-=Math.floor(e.y);break;case Fe:e.y=e.y<0?0:1;break;case Ie:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y-=Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Vt.DEFAULT_IMAGE=null,Vt.DEFAULT_MAPPING=300,Vt.DEFAULT_ANISOTROPY=1;var Ht=class e{constructor(t=0,n=0,r=0,i=1){e.prototype.isVector4=!0,this.x=t,this.y=n,this.z=r,this.w=i}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,r){return this.x=e,this.y=t,this.z=n,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw Error(`index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error(`index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w===void 0?1:e.w,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*r+a[12]*i,this.y=a[1]*t+a[5]*n+a[9]*r+a[13]*i,this.z=a[2]*t+a[6]*n+a[10]*r+a[14]*i,this.w=a[3]*t+a[7]*n+a[11]*r+a[15]*i,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,r,i,a=.01,o=.1,s=e.elements,c=s[0],l=s[4],u=s[8],d=s[1],f=s[5],p=s[9],m=s[2],h=s[6],g=s[10];if(Math.abs(l-d)<a&&Math.abs(u-m)<a&&Math.abs(p-h)<a){if(Math.abs(l+d)<o&&Math.abs(u+m)<o&&Math.abs(p+h)<o&&Math.abs(c+f+g-3)<o)return this.set(1,0,0,0),this;t=Math.PI;let e=(c+1)/2,s=(f+1)/2,_=(g+1)/2,v=(l+d)/4,y=(u+m)/4,b=(p+h)/4;return e>s&&e>_?e<a?(n=0,r=.707106781,i=.707106781):(n=Math.sqrt(e),r=v/n,i=y/n):s>_?s<a?(n=.707106781,r=0,i=.707106781):(r=Math.sqrt(s),n=v/r,i=b/r):_<a?(n=.707106781,r=.707106781,i=0):(i=Math.sqrt(_),n=y/i,r=b/i),this.set(n,r,i,t),this}let _=Math.sqrt((h-p)*(h-p)+(u-m)*(u-m)+(d-l)*(d-l));return Math.abs(_)<.001&&(_=1),this.x=(h-p)/_,this.y=(u-m)/_,this.z=(d-l)/_,this.w=Math.acos((c+f+g-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Ut=class{constructor(e=0,t=0,n=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=r}static slerpFlat(e,t,n,r,i,a,o){let s=n[r+0],c=n[r+1],l=n[r+2],u=n[r+3],d=i[a+0],f=i[a+1],p=i[a+2],m=i[a+3];if(o===0){e[t+0]=s,e[t+1]=c,e[t+2]=l,e[t+3]=u;return}if(o===1){e[t+0]=d,e[t+1]=f,e[t+2]=p,e[t+3]=m;return}if(u!==m||s!==d||c!==f||l!==p){let e=1-o,t=s*d+c*f+l*p+u*m,n=t>=0?1:-1,r=1-t*t;if(r>2**-52){let i=Math.sqrt(r),a=Math.atan2(i,t*n);e=Math.sin(e*a)/i,o=Math.sin(o*a)/i}let i=o*n;if(s=s*e+d*i,c=c*e+f*i,l=l*e+p*i,u=u*e+m*i,e===1-o){let e=1/Math.sqrt(s*s+c*c+l*l+u*u);s*=e,c*=e,l*=e,u*=e}}e[t]=s,e[t+1]=c,e[t+2]=l,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,r,i,a){let o=n[r],s=n[r+1],c=n[r+2],l=n[r+3],u=i[a],d=i[a+1],f=i[a+2],p=i[a+3];return e[t]=o*p+l*u+s*f-c*d,e[t+1]=s*p+l*d+c*u-o*f,e[t+2]=c*p+l*f+o*d-s*u,e[t+3]=l*p-o*u-s*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,r){return this._x=e,this._y=t,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,r=e._y,i=e._z,a=e._order,o=Math.cos,s=Math.sin,c=o(n/2),l=o(r/2),u=o(i/2),d=s(n/2),f=s(r/2),p=s(i/2);switch(a){case`XYZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`YXZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`ZXY`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`ZYX`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`YZX`:this._x=d*l*u+c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u-d*f*p;break;case`XZY`:this._x=d*l*u-c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u+d*f*p;break;default:console.warn(`THREE.Quaternion: .setFromEuler() encountered an unknown order: `+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,r=Math.sin(n);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],r=t[4],i=t[8],a=t[1],o=t[5],s=t[9],c=t[2],l=t[6],u=t[10],d=n+o+u;if(d>0){let e=.5/Math.sqrt(d+1);this._w=.25/e,this._x=(l-s)*e,this._y=(i-c)*e,this._z=(a-r)*e}else if(n>o&&n>u){let e=2*Math.sqrt(1+n-o-u);this._w=(l-s)/e,this._x=.25*e,this._y=(r+a)/e,this._z=(i+c)/e}else if(o>u){let e=2*Math.sqrt(1+o-n-u);this._w=(i-c)/e,this._x=(r+a)/e,this._y=.25*e,this._z=(s+l)/e}else{let e=2*Math.sqrt(1+u-n-o);this._w=(a-r)/e,this._x=(i+c)/e,this._y=(s+l)/e,this._z=.25*e}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<2**-52?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(M(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let r=Math.min(1,t/n);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x*=e,this._y*=e,this._z*=e,this._w*=e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=t._x,s=t._y,c=t._z,l=t._w;return this._x=n*l+a*o+r*c-i*s,this._y=r*l+a*s+i*o-n*c,this._z=i*l+a*c+n*s-r*o,this._w=a*l-n*o-r*s-i*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);let n=this._x,r=this._y,i=this._z,a=this._w,o=a*e._w+n*e._x+r*e._y+i*e._z;if(o<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,o=-o):this.copy(e),o>=1)return this._w=a,this._x=n,this._y=r,this._z=i,this;let s=1-o*o;if(s<=2**-52){let e=1-t;return this._w=e*a+t*this._w,this._x=e*n+t*this._x,this._y=e*r+t*this._y,this._z=e*i+t*this._z,this.normalize(),this}let c=Math.sqrt(s),l=Math.atan2(c,o),u=Math.sin((1-t)*l)/c,d=Math.sin(t*l)/c;return this._w=a*u+this._w*d,this._x=n*u+this._x*d,this._y=r*u+this._y*d,this._z=i*u+this._z*d,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),i=Math.sqrt(n);return this.set(r*Math.sin(e),r*Math.cos(e),i*Math.sin(t),i*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},I=class e{constructor(t=0,n=0,r=0){e.prototype.isVector3=!0,this.x=t,this.y=n,this.z=r}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw Error(`index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error(`index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Gt.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Gt.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6]*r,this.y=i[1]*t+i[4]*n+i[7]*r,this.z=i[2]*t+i[5]*n+i[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=e.elements,a=1/(i[3]*t+i[7]*n+i[11]*r+i[15]);return this.x=(i[0]*t+i[4]*n+i[8]*r+i[12])*a,this.y=(i[1]*t+i[5]*n+i[9]*r+i[13])*a,this.z=(i[2]*t+i[6]*n+i[10]*r+i[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,r=this.z,i=e.x,a=e.y,o=e.z,s=e.w,c=2*(a*r-o*n),l=2*(o*t-i*r),u=2*(i*n-a*t);return this.x=t+s*c+a*u-o*l,this.y=n+s*l+o*c-i*u,this.z=r+s*u+i*l-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[4]*n+i[8]*r,this.y=i[1]*t+i[5]*n+i[9]*r,this.z=i[2]*t+i[6]*n+i[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,r=e.y,i=e.z,a=t.x,o=t.y,s=t.z;return this.x=r*s-i*o,this.y=i*a-n*s,this.z=n*o-r*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Wt.copy(this).projectOnVector(e),this.sub(Wt)}reflect(e){return this.sub(Wt.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(M(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,r=this.z-e.z;return t*t+n*n+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let r=Math.sin(t)*e;return this.x=r*Math.sin(n),this.y=Math.cos(t)*e,this.z=r*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Wt=new I,Gt=new Ut,Kt=class{constructor(e=new I(1/0,1/0,1/0),t=new I(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(R.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(R.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=R.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute(`position`);if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let t=0,n=r.count;t<n;t++)e.isMesh===!0?e.getVertexPosition(t,R):R.fromBufferAttribute(r,t),R.applyMatrix4(e.matrixWorld),this.expandByPoint(R);else e.boundingBox===void 0?(n.boundingBox===null&&n.computeBoundingBox(),qt.copy(n.boundingBox)):(e.boundingBox===null&&e.computeBoundingBox(),qt.copy(e.boundingBox)),qt.applyMatrix4(e.matrixWorld),this.union(qt)}let r=e.children;for(let e=0,n=r.length;e<n;e++)this.expandByObject(r[e],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,R),R.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(en),tn.subVectors(this.max,en),Jt.subVectors(e.a,en),Yt.subVectors(e.b,en),Xt.subVectors(e.c,en),Zt.subVectors(Yt,Jt),Qt.subVectors(Xt,Yt),$t.subVectors(Jt,Xt);let t=[0,-Zt.z,Zt.y,0,-Qt.z,Qt.y,0,-$t.z,$t.y,Zt.z,0,-Zt.x,Qt.z,0,-Qt.x,$t.z,0,-$t.x,-Zt.y,Zt.x,0,-Qt.y,Qt.x,0,-$t.y,$t.x,0];return!an(t,Jt,Yt,Xt,tn)||(t=[1,0,0,0,1,0,0,0,1],!an(t,Jt,Yt,Xt,tn))?!1:(nn.crossVectors(Zt,Qt),t=[nn.x,nn.y,nn.z],an(t,Jt,Yt,Xt,tn))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,R).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(R).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(L[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),L[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),L[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),L[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),L[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),L[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),L[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),L[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(L),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}},L=[new I,new I,new I,new I,new I,new I,new I,new I],R=new I,qt=new Kt,Jt=new I,Yt=new I,Xt=new I,Zt=new I,Qt=new I,$t=new I,en=new I,tn=new I,nn=new I,rn=new I;function an(e,t,n,r,i){for(let a=0,o=e.length-3;a<=o;a+=3){rn.fromArray(e,a);let o=i.x*Math.abs(rn.x)+i.y*Math.abs(rn.y)+i.z*Math.abs(rn.z),s=t.dot(rn),c=n.dot(rn),l=r.dot(rn);if(Math.max(-Math.max(s,c,l),Math.min(s,c,l))>o)return!1}return!0}var on=new Kt,sn=new I,cn=new I,ln=class{constructor(e=new I,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t===void 0?on.setFromPoints(e).getCenter(n):n.copy(t);let r=0;for(let t=0,i=e.length;t<i;t++)r=Math.max(r,n.distanceToSquared(e[t]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius*=e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;sn.subVectors(e,this.center);let t=sn.lengthSq();if(t>this.radius*this.radius){let e=Math.sqrt(t),n=(e-this.radius)*.5;this.center.addScaledVector(sn,n/e),this.radius+=n}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(cn.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(sn.copy(e.center).add(cn)),this.expandByPoint(sn.copy(e.center).sub(cn))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}},z=new I,un=new I,dn=new I,fn=new I,pn=new I,mn=new I,hn=new I,gn=class{constructor(e=new I,t=new I(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,z)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=z.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(z.copy(this.origin).addScaledVector(this.direction,t),z.distanceToSquared(e))}distanceSqToSegment(e,t,n,r){un.copy(e).add(t).multiplyScalar(.5),dn.copy(t).sub(e).normalize(),fn.copy(this.origin).sub(un);let i=e.distanceTo(t)*.5,a=-this.direction.dot(dn),o=fn.dot(this.direction),s=-fn.dot(dn),c=fn.lengthSq(),l=Math.abs(1-a*a),u,d,f,p;if(l>0)if(u=a*s-o,d=a*o-s,p=i*l,u>=0)if(d>=-p)if(d<=p){let e=1/l;u*=e,d*=e,f=u*(u+a*d+2*o)+d*(a*u+d+2*s)+c}else d=i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;else d=-i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;else d<=-p?(u=Math.max(0,-(-a*i+o)),d=u>0?-i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c):d<=p?(u=0,d=Math.min(Math.max(-i,-s),i),f=d*(d+2*s)+c):(u=Math.max(0,-(a*i+o)),d=u>0?i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c);else d=a>0?-i:i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),r&&r.copy(un).addScaledVector(dn,d),f}intersectSphere(e,t){z.subVectors(e.center,this.origin);let n=z.dot(this.direction),r=z.dot(z)-n*n,i=e.radius*e.radius;if(r>i)return null;let a=Math.sqrt(i-r),o=n-a,s=n+a;return s<0?null:o<0?this.at(s,t):this.at(o,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,r,i,a,o,s,c=1/this.direction.x,l=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,r=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,r=(e.min.x-d.x)*c),l>=0?(i=(e.min.y-d.y)*l,a=(e.max.y-d.y)*l):(i=(e.max.y-d.y)*l,a=(e.min.y-d.y)*l),n>a||i>r||((i>n||isNaN(n))&&(n=i),(a<r||isNaN(r))&&(r=a),u>=0?(o=(e.min.z-d.z)*u,s=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,s=(e.min.z-d.z)*u),n>s||o>r)||((o>n||n!==n)&&(n=o),(s<r||r!==r)&&(r=s),r<0)?null:this.at(n>=0?n:r,t)}intersectsBox(e){return this.intersectBox(e,z)!==null}intersectTriangle(e,t,n,r,i){pn.subVectors(t,e),mn.subVectors(n,e),hn.crossVectors(pn,mn);let a=this.direction.dot(hn),o;if(a>0){if(r)return null;o=1}else if(a<0)o=-1,a=-a;else return null;fn.subVectors(this.origin,e);let s=o*this.direction.dot(mn.crossVectors(fn,mn));if(s<0)return null;let c=o*this.direction.dot(pn.cross(fn));if(c<0||s+c>a)return null;let l=-o*fn.dot(hn);return l<0?null:this.at(l/a,i)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},B=class e{constructor(t,n,r,i,a,o,s,c,l,u,d,f,p,m,h,g){e.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,n,r,i,a,o,s,c,l,u,d,f,p,m,h,g)}set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){let g=this.elements;return g[0]=e,g[4]=t,g[8]=n,g[12]=r,g[1]=i,g[5]=a,g[9]=o,g[13]=s,g[2]=c,g[6]=l,g[10]=u,g[14]=d,g[3]=f,g[7]=p,g[11]=m,g[15]=h,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new e().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){let t=this.elements,n=e.elements,r=1/_n.setFromMatrixColumn(e,0).length(),i=1/_n.setFromMatrixColumn(e,1).length(),a=1/_n.setFromMatrixColumn(e,2).length();return t[0]=n[0]*r,t[1]=n[1]*r,t[2]=n[2]*r,t[3]=0,t[4]=n[4]*i,t[5]=n[5]*i,t[6]=n[6]*i,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,r=e.y,i=e.z,a=Math.cos(n),o=Math.sin(n),s=Math.cos(r),c=Math.sin(r),l=Math.cos(i),u=Math.sin(i);if(e.order===`XYZ`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=-s*u,t[8]=c,t[1]=n+r*c,t[5]=e-i*c,t[9]=-o*s,t[2]=i-e*c,t[6]=r+n*c,t[10]=a*s}else if(e.order===`YXZ`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e+i*o,t[4]=r*o-n,t[8]=a*c,t[1]=a*u,t[5]=a*l,t[9]=-o,t[2]=n*o-r,t[6]=i+e*o,t[10]=a*s}else if(e.order===`ZXY`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e-i*o,t[4]=-a*u,t[8]=r+n*o,t[1]=n+r*o,t[5]=a*l,t[9]=i-e*o,t[2]=-a*c,t[6]=o,t[10]=a*s}else if(e.order===`ZYX`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=r*c-n,t[8]=e*c+i,t[1]=s*u,t[5]=i*c+e,t[9]=n*c-r,t[2]=-c,t[6]=o*s,t[10]=a*s}else if(e.order===`YZX`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=i-e*u,t[8]=r*u+n,t[1]=u,t[5]=a*l,t[9]=-o*l,t[2]=-c*l,t[6]=n*u+r,t[10]=e-i*u}else if(e.order===`XZY`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=-u,t[8]=c*l,t[1]=e*u+i,t[5]=a*l,t[9]=n*u-r,t[2]=r*u-n,t[6]=o*l,t[10]=i*u+e}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(vn,e,yn)}lookAt(e,t,n){let r=this.elements;return H.subVectors(e,t),H.lengthSq()===0&&(H.z=1),H.normalize(),bn.crossVectors(n,H),bn.lengthSq()===0&&(Math.abs(n.z)===1?H.x+=1e-4:H.z+=1e-4,H.normalize(),bn.crossVectors(n,H)),bn.normalize(),xn.crossVectors(H,bn),r[0]=bn.x,r[4]=xn.x,r[8]=H.x,r[1]=bn.y,r[5]=xn.y,r[9]=H.y,r[2]=bn.z,r[6]=xn.z,r[10]=H.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[4],s=n[8],c=n[12],l=n[1],u=n[5],d=n[9],f=n[13],p=n[2],m=n[6],h=n[10],g=n[14],_=n[3],v=n[7],y=n[11],b=n[15],x=r[0],S=r[4],C=r[8],w=r[12],T=r[1],E=r[5],D=r[9],ee=r[13],te=r[2],O=r[6],ne=r[10],re=r[14],k=r[3],ie=r[7],ae=r[11],oe=r[15];return i[0]=a*x+o*T+s*te+c*k,i[4]=a*S+o*E+s*O+c*ie,i[8]=a*C+o*D+s*ne+c*ae,i[12]=a*w+o*ee+s*re+c*oe,i[1]=l*x+u*T+d*te+f*k,i[5]=l*S+u*E+d*O+f*ie,i[9]=l*C+u*D+d*ne+f*ae,i[13]=l*w+u*ee+d*re+f*oe,i[2]=p*x+m*T+h*te+g*k,i[6]=p*S+m*E+h*O+g*ie,i[10]=p*C+m*D+h*ne+g*ae,i[14]=p*w+m*ee+h*re+g*oe,i[3]=_*x+v*T+y*te+b*k,i[7]=_*S+v*E+y*O+b*ie,i[11]=_*C+v*D+y*ne+b*ae,i[15]=_*w+v*ee+y*re+b*oe,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[12],a=e[1],o=e[5],s=e[9],c=e[13],l=e[2],u=e[6],d=e[10],f=e[14],p=e[3],m=e[7],h=e[11],g=e[15];return p*(+i*s*u-r*c*u-i*o*d+n*c*d+r*o*f-n*s*f)+m*(+t*s*f-t*c*d+i*a*d-r*a*f+r*c*l-i*s*l)+h*(+t*c*u-t*o*f-i*a*u+n*a*f+i*o*l-n*c*l)+g*(-r*o*l-t*s*u+t*o*d+r*a*u-n*a*d+n*s*l)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=e[9],d=e[10],f=e[11],p=e[12],m=e[13],h=e[14],g=e[15],_=u*h*c-m*d*c+m*s*f-o*h*f-u*s*g+o*d*g,v=p*d*c-l*h*c-p*s*f+a*h*f+l*s*g-a*d*g,y=l*m*c-p*u*c+p*o*f-a*m*f-l*o*g+a*u*g,b=p*u*s-l*m*s-p*o*d+a*m*d+l*o*h-a*u*h,x=t*_+n*v+r*y+i*b;if(x===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let S=1/x;return e[0]=_*S,e[1]=(m*d*i-u*h*i-m*r*f+n*h*f+u*r*g-n*d*g)*S,e[2]=(o*h*i-m*s*i+m*r*c-n*h*c-o*r*g+n*s*g)*S,e[3]=(u*s*i-o*d*i-u*r*c+n*d*c+o*r*f-n*s*f)*S,e[4]=v*S,e[5]=(l*h*i-p*d*i+p*r*f-t*h*f-l*r*g+t*d*g)*S,e[6]=(p*s*i-a*h*i-p*r*c+t*h*c+a*r*g-t*s*g)*S,e[7]=(a*d*i-l*s*i+l*r*c-t*d*c-a*r*f+t*s*f)*S,e[8]=y*S,e[9]=(p*u*i-l*m*i-p*n*f+t*m*f+l*n*g-t*u*g)*S,e[10]=(a*m*i-p*o*i+p*n*c-t*m*c-a*n*g+t*o*g)*S,e[11]=(l*o*i-a*u*i-l*n*c+t*u*c+a*n*f-t*o*f)*S,e[12]=b*S,e[13]=(l*m*r-p*u*r+p*n*d-t*m*d-l*n*h+t*u*h)*S,e[14]=(p*o*r-a*m*r-p*n*s+t*m*s+a*n*h-t*o*h)*S,e[15]=(a*u*r-l*o*r+l*n*s-t*u*s-a*n*d+t*o*d)*S,this}scale(e){let t=this.elements,n=e.x,r=e.y,i=e.z;return t[0]*=n,t[4]*=r,t[8]*=i,t[1]*=n,t[5]*=r,t[9]*=i,t[2]*=n,t[6]*=r,t[10]*=i,t[3]*=n,t[7]*=r,t[11]*=i,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,r))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),r=Math.sin(t),i=1-n,a=e.x,o=e.y,s=e.z,c=i*a,l=i*o;return this.set(c*a+n,c*o-r*s,c*s+r*o,0,c*o+r*s,l*o+n,l*s-r*a,0,c*s-r*o,l*s+r*a,i*s*s+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,r,i,a){return this.set(1,n,i,0,e,1,a,0,t,r,1,0,0,0,0,1),this}compose(e,t,n){let r=this.elements,i=t._x,a=t._y,o=t._z,s=t._w,c=i+i,l=a+a,u=o+o,d=i*c,f=i*l,p=i*u,m=a*l,h=a*u,g=o*u,_=s*c,v=s*l,y=s*u,b=n.x,x=n.y,S=n.z;return r[0]=(1-(m+g))*b,r[1]=(f+y)*b,r[2]=(p-v)*b,r[3]=0,r[4]=(f-y)*x,r[5]=(1-(d+g))*x,r[6]=(h+_)*x,r[7]=0,r[8]=(p+v)*S,r[9]=(h-_)*S,r[10]=(1-(d+m))*S,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,n){let r=this.elements,i=_n.set(r[0],r[1],r[2]).length(),a=_n.set(r[4],r[5],r[6]).length(),o=_n.set(r[8],r[9],r[10]).length();this.determinant()<0&&(i=-i),e.x=r[12],e.y=r[13],e.z=r[14],V.copy(this);let s=1/i,c=1/a,l=1/o;return V.elements[0]*=s,V.elements[1]*=s,V.elements[2]*=s,V.elements[4]*=c,V.elements[5]*=c,V.elements[6]*=c,V.elements[8]*=l,V.elements[9]*=l,V.elements[10]*=l,t.setFromRotationMatrix(V),n.x=i,n.y=a,n.z=o,this}makePerspective(e,t,n,r,i,a,o=et){let s=this.elements,c=2*i/(t-e),l=2*i/(n-r),u=(t+e)/(t-e),d=(n+r)/(n-r),f,p;if(o===2e3)f=-(a+i)/(a-i),p=-2*a*i/(a-i);else if(o===2001)f=-a/(a-i),p=-a*i/(a-i);else throw Error(`THREE.Matrix4.makePerspective(): Invalid coordinate system: `+o);return s[0]=c,s[4]=0,s[8]=u,s[12]=0,s[1]=0,s[5]=l,s[9]=d,s[13]=0,s[2]=0,s[6]=0,s[10]=f,s[14]=p,s[3]=0,s[7]=0,s[11]=-1,s[15]=0,this}makeOrthographic(e,t,n,r,i,a,o=et){let s=this.elements,c=1/(t-e),l=1/(n-r),u=1/(a-i),d=(t+e)*c,f=(n+r)*l,p,m;if(o===2e3)p=(a+i)*u,m=-2*u;else if(o===2001)p=i*u,m=-1*u;else throw Error(`THREE.Matrix4.makeOrthographic(): Invalid coordinate system: `+o);return s[0]=2*c,s[4]=0,s[8]=0,s[12]=-d,s[1]=0,s[5]=2*l,s[9]=0,s[13]=-f,s[2]=0,s[6]=0,s[10]=m,s[14]=-p,s[3]=0,s[7]=0,s[11]=0,s[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<16;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},_n=new I,V=new B,vn=new I(0,0,0),yn=new I(1,1,1),bn=new I,xn=new I,H=new I,Sn=new B,Cn=new Ut,wn=class e{constructor(t=0,n=0,r=0,i=e.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=n,this._z=r,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,r=this._order){return this._x=e,this._y=t,this._z=n,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let r=e.elements,i=r[0],a=r[4],o=r[8],s=r[1],c=r[5],l=r[9],u=r[2],d=r[6],f=r[10];switch(t){case`XYZ`:this._y=Math.asin(M(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-l,f),this._z=Math.atan2(-a,i)):(this._x=Math.atan2(d,c),this._z=0);break;case`YXZ`:this._x=Math.asin(-M(l,-1,1)),Math.abs(l)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(s,c)):(this._y=Math.atan2(-u,i),this._z=0);break;case`ZXY`:this._x=Math.asin(M(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(s,i));break;case`ZYX`:this._y=Math.asin(-M(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(s,i)):(this._x=0,this._z=Math.atan2(-a,c));break;case`YZX`:this._z=Math.asin(M(s,-1,1)),Math.abs(s)<.9999999?(this._x=Math.atan2(-l,c),this._y=Math.atan2(-u,i)):(this._x=0,this._y=Math.atan2(o,f));break;case`XZY`:this._z=Math.asin(-M(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,i)):(this._x=Math.atan2(-l,f),this._y=0);break;default:console.warn(`THREE.Euler: .setFromRotationMatrix() encountered an unknown order: `+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Sn.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Sn,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Cn.setFromEuler(this),this.setFromQuaternion(Cn,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};wn.DEFAULT_ORDER=`XYZ`;var Tn=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!=0}},En=0,Dn=new I,On=new Ut,U=new B,kn=new I,An=new I,jn=new I,Mn=new Ut,Nn=new I(1,0,0),Pn=new I(0,1,0),Fn=new I(0,0,1),In={type:`added`},Ln={type:`removed`},Rn={type:`childadded`,child:null},zn={type:`childremoved`,child:null},Bn=class e extends tt{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:En++}),this.uuid=at(),this.name=``,this.type=`Object3D`,this.parent=null,this.children=[],this.up=e.DEFAULT_UP.clone();let t=new I,n=new wn,r=new Ut,i=new I(1,1,1);function a(){r.setFromEuler(n,!1)}function o(){n.setFromQuaternion(r,void 0,!1)}n._onChange(a),r._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:r},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new B},normalMatrix:{value:new P}}),this.matrix=new B,this.matrixWorld=new B,this.matrixAutoUpdate=e.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=e.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Tn,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return On.setFromAxisAngle(e,t),this.quaternion.multiply(On),this}rotateOnWorldAxis(e,t){return On.setFromAxisAngle(e,t),this.quaternion.premultiply(On),this}rotateX(e){return this.rotateOnAxis(Nn,e)}rotateY(e){return this.rotateOnAxis(Pn,e)}rotateZ(e){return this.rotateOnAxis(Fn,e)}translateOnAxis(e,t){return Dn.copy(e).applyQuaternion(this.quaternion),this.position.add(Dn.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Nn,e)}translateY(e){return this.translateOnAxis(Pn,e)}translateZ(e){return this.translateOnAxis(Fn,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(U.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?kn.copy(e):kn.set(e,t,n);let r=this.parent;this.updateWorldMatrix(!0,!1),An.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?U.lookAt(An,kn,this.up):U.lookAt(kn,An,this.up),this.quaternion.setFromRotationMatrix(U),r&&(U.extractRotation(r.matrixWorld),On.setFromRotationMatrix(U),this.quaternion.premultiply(On.invert()))}add(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return e===this?(console.error(`THREE.Object3D.add: object can't be added as a child of itself.`,e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(In),Rn.child=e,this.dispatchEvent(Rn),Rn.child=null):console.error(`THREE.Object3D.add: object not an instance of THREE.Object3D.`,e),this)}remove(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.remove(arguments[e]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Ln),zn.child=e,this.dispatchEvent(zn),zn.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),U.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),U.multiply(e.parent.matrixWorld)),e.applyMatrix4(U),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(In),Rn.child=e,this.dispatchEvent(Rn),Rn.child=null,this}getObjectById(e){return this.getObjectByProperty(`id`,e)}getObjectByName(e){return this.getObjectByProperty(`name`,e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,r=this.children.length;n<r;n++){let r=this.children[n].getObjectByProperty(e,t);if(r!==void 0)return r}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let r=this.children;for(let i=0,a=r.length;i<a;i++)r[i].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(An,e,jn),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(An,Mn,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let e=this.children;for(let t=0,n=e.length;t<n;t++)e[t].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e==`string`,n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:`Object`,generator:`Object3D.toJSON`});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==``&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.isInstancedMesh&&(r.type=`InstancedMesh`,r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type=`BatchedMesh`,r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.visibility=this._visibility,r.active=this._active,r.bounds=this._bounds.map(e=>({boxInitialized:e.boxInitialized,boxMin:e.box.min.toArray(),boxMax:e.box.max.toArray(),sphereInitialized:e.sphereInitialized,sphereRadius:e.sphere.radius,sphereCenter:e.sphere.center.toArray()})),r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.geometryCount=this._geometryCount,r.matricesTexture=this._matricesTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere={center:r.boundingSphere.center.toArray(),radius:r.boundingSphere.radius}),this.boundingBox!==null&&(r.boundingBox={min:r.boundingBox.min.toArray(),max:r.boundingBox.max.toArray()}));function i(t,n){return t[n.uuid]===void 0&&(t[n.uuid]=n.toJSON(e)),n.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=i(e.geometries,this.geometry);let t=this.geometry.parameters;if(t!==void 0&&t.shapes!==void 0){let n=t.shapes;if(Array.isArray(n))for(let t=0,r=n.length;t<r;t++){let r=n[t];i(e.shapes,r)}else i(e.shapes,n)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(i(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let t=[];for(let n=0,r=this.material.length;n<r;n++)t.push(i(e.materials,this.material[n]));r.material=t}else r.material=i(e.materials,this.material);if(this.children.length>0){r.children=[];for(let t=0;t<this.children.length;t++)r.children.push(this.children[t].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let t=0;t<this.animations.length;t++){let n=this.animations[t];r.animations.push(i(e.animations,n))}}if(t){let t=a(e.geometries),r=a(e.materials),i=a(e.textures),o=a(e.images),s=a(e.shapes),c=a(e.skeletons),l=a(e.animations),u=a(e.nodes);t.length>0&&(n.geometries=t),r.length>0&&(n.materials=r),i.length>0&&(n.textures=i),o.length>0&&(n.images=o),s.length>0&&(n.shapes=s),c.length>0&&(n.skeletons=c),l.length>0&&(n.animations=l),u.length>0&&(n.nodes=u)}return n.object=r,n;function a(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let t=0;t<e.children.length;t++){let n=e.children[t];this.add(n.clone())}return this}};Bn.DEFAULT_UP=new I(0,1,0),Bn.DEFAULT_MATRIX_AUTO_UPDATE=!0,Bn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Vn={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Hn={h:0,s:0,l:0},Un={h:0,s:0,l:0};function Wn(e,t,n){return n<0&&(n+=1),n>1&&--n,n<1/6?e+(t-e)*6*n:n<1/2?t:n<2/3?e+(t-e)*6*(2/3-n):e}var W=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let t=e;t&&t.isColor?this.copy(t):typeof t==`number`?this.setHex(t):typeof t==`string`&&this.setStyle(t)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=qe){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,F.toWorkingColorSpace(this,t),this}setRGB(e,t,n,r=F.workingColorSpace){return this.r=e,this.g=t,this.b=n,F.toWorkingColorSpace(this,r),this}setHSL(e,t,n,r=F.workingColorSpace){if(e=ot(e,1),t=M(t,0,1),n=M(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,i=2*n-r;this.r=Wn(i,r,e+1/3),this.g=Wn(i,r,e),this.b=Wn(i,r,e-1/3)}return F.toWorkingColorSpace(this,r),this}setStyle(e,t=qe){function n(t){t!==void 0&&parseFloat(t)<1&&console.warn(`THREE.Color: Alpha component of `+e+` will be ignored.`)}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let i,a=r[1],o=r[2];switch(a){case`rgb`:case`rgba`:if(i=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(255,parseInt(i[1],10))/255,Math.min(255,parseInt(i[2],10))/255,Math.min(255,parseInt(i[3],10))/255,t);if(i=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(100,parseInt(i[1],10))/100,Math.min(100,parseInt(i[2],10))/100,Math.min(100,parseInt(i[3],10))/100,t);break;case`hsl`:case`hsla`:if(i=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setHSL(parseFloat(i[1])/360,parseFloat(i[2])/100,parseFloat(i[3])/100,t);break;default:console.warn(`THREE.Color: Unknown color model `+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let n=r[1],i=n.length;if(i===3)return this.setRGB(parseInt(n.charAt(0),16)/15,parseInt(n.charAt(1),16)/15,parseInt(n.charAt(2),16)/15,t);if(i===6)return this.setHex(parseInt(n,16),t);console.warn(`THREE.Color: Invalid hex color `+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=qe){let n=Vn[e.toLowerCase()];return n===void 0?console.warn(`THREE.Color: Unknown color `+e):this.setHex(n,t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Nt(e.r),this.g=Nt(e.g),this.b=Nt(e.b),this}copyLinearToSRGB(e){return this.r=Pt(e.r),this.g=Pt(e.g),this.b=Pt(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=qe){return F.fromWorkingColorSpace(G.copy(this),e),Math.round(M(G.r*255,0,255))*65536+Math.round(M(G.g*255,0,255))*256+Math.round(M(G.b*255,0,255))}getHexString(e=qe){return(`000000`+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=F.workingColorSpace){F.fromWorkingColorSpace(G.copy(this),t);let n=G.r,r=G.g,i=G.b,a=Math.max(n,r,i),o=Math.min(n,r,i),s,c,l=(o+a)/2;if(o===a)s=0,c=0;else{let e=a-o;switch(c=l<=.5?e/(a+o):e/(2-a-o),a){case n:s=(r-i)/e+(r<i?6:0);break;case r:s=(i-n)/e+2;break;case i:s=(n-r)/e+4;break}s/=6}return e.h=s,e.s=c,e.l=l,e}getRGB(e,t=F.workingColorSpace){return F.fromWorkingColorSpace(G.copy(this),t),e.r=G.r,e.g=G.g,e.b=G.b,e}getStyle(e=qe){F.fromWorkingColorSpace(G.copy(this),e);let t=G.r,n=G.g,r=G.b;return e===`srgb`?`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(r*255)})`:`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${r.toFixed(3)})`}offsetHSL(e,t,n){return this.getHSL(Hn),this.setHSL(Hn.h+e,Hn.s+t,Hn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Hn),e.getHSL(Un);let n=lt(Hn.h,Un.h,t),r=lt(Hn.s,Un.s,t),i=lt(Hn.l,Un.l,t);return this.setHSL(n,r,i),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,r=this.b,i=e.elements;return this.r=i[0]*t+i[3]*n+i[6]*r,this.g=i[1]*t+i[4]*n+i[7]*r,this.b=i[2]*t+i[5]*n+i[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},G=new W;W.NAMES=Vn;function Gn(e){let t={};for(let n in e){t[n]={};for(let r in e[n]){let i=e[n][r];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn(`UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms().`),t[n][r]=null):t[n][r]=i.clone():Array.isArray(i)?t[n][r]=i.slice():t[n][r]=i}}return t}function K(e){let t={};for(let n=0;n<e.length;n++){let r=Gn(e[n]);for(let e in r)t[e]=r[e]}return t}var Kn=class extends Bn{constructor(){super(),this.isCamera=!0,this.type=`Camera`,this.matrixWorldInverse=new B,this.projectionMatrix=new B,this.projectionMatrixInverse=new B,this.coordinateSystem=et}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},qn=new I,Jn=new N,Yn=new N,Xn=class extends Kn{constructor(e=50,t=1,n=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type=`PerspectiveCamera`,this.fov=e,this.zoom=1,this.near=n,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=it*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(rt*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return it*2*Math.atan(Math.tan(rt*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){qn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(qn.x,qn.y).multiplyScalar(-e/qn.z),qn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(qn.x,qn.y).multiplyScalar(-e/qn.z)}getViewSize(e,t){return this.getViewBounds(e,Jn,Yn),t.subVectors(Yn,Jn)}setViewOffset(e,t,n,r,i,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(rt*.5*this.fov)/this.zoom,n=2*t,r=this.aspect*n,i=-.5*r,a=this.view;if(this.view!==null&&this.view.enabled){let e=a.fullWidth,o=a.fullHeight;i+=a.offsetX*r/e,t-=a.offsetY*n/o,r*=a.width/e,n*=a.height/o}let o=this.filmOffset;o!==0&&(i+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(i,i+r,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},Zn=new I,Qn=new I,$n=new P,er=class{constructor(e=new I(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,r){return this.normal.set(e,t,n),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let r=Zn.subVectors(n,t).cross(Qn.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let n=e.delta(Zn),r=this.normal.dot(n);if(r===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let i=-(e.start.dot(this.normal)+this.constant)/r;return i<0||i>1?null:t.copy(e.start).addScaledVector(n,i)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||$n.getNormalMatrix(e),r=this.coplanarPoint(Zn).applyMatrix4(e),i=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(i),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},tr=new ln,nr=new I,rr=class{constructor(e=new er,t=new er,n=new er,r=new er,i=new er,a=new er){this.planes=[e,t,n,r,i,a]}set(e,t,n,r,i,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(r),o[4].copy(i),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=et){let n=this.planes,r=e.elements,i=r[0],a=r[1],o=r[2],s=r[3],c=r[4],l=r[5],u=r[6],d=r[7],f=r[8],p=r[9],m=r[10],h=r[11],g=r[12],_=r[13],v=r[14],y=r[15];if(n[0].setComponents(s-i,d-c,h-f,y-g).normalize(),n[1].setComponents(s+i,d+c,h+f,y+g).normalize(),n[2].setComponents(s+a,d+l,h+p,y+_).normalize(),n[3].setComponents(s-a,d-l,h-p,y-_).normalize(),n[4].setComponents(s-o,d-u,h-m,y-v).normalize(),t===2e3)n[5].setComponents(s+o,d+u,h+m,y+v).normalize();else if(t===2001)n[5].setComponents(o,u,m,v).normalize();else throw Error(`THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: `+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),tr.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),tr.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(tr)}intersectsSprite(e){return tr.center.set(0,0,0),tr.radius=.7071067811865476,tr.applyMatrix4(e.matrixWorld),this.intersectsSphere(tr)}intersectsSphere(e){let t=this.planes,n=e.center,r=-e.radius;for(let e=0;e<6;e++)if(t[e].distanceToPoint(n)<r)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let r=t[n];if(nr.x=r.normal.x>0?e.max.x:e.min.x,nr.y=r.normal.y>0?e.max.y:e.min.y,nr.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(nr)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},q={alphahash_fragment:`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,alphahash_pars_fragment:`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,alphamap_fragment:`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,alphamap_pars_fragment:`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,alphatest_fragment:`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,alphatest_pars_fragment:`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,aomap_fragment:`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,aomap_pars_fragment:`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,batching_pars_vertex:`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,batching_vertex:`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,begin_vertex:`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,beginnormal_vertex:`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bsdfs:`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,iridescence_fragment:`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,bumpmap_pars_fragment:`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,clipping_planes_fragment:`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,clipping_planes_pars_fragment:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,clipping_planes_pars_vertex:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,clipping_planes_vertex:`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,color_fragment:`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,color_pars_fragment:`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,color_pars_vertex:`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,color_vertex:`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,common:`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,cube_uv_reflection_fragment:`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,defaultnormal_vertex:`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,displacementmap_pars_vertex:`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,displacementmap_vertex:`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,emissivemap_fragment:`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,emissivemap_pars_fragment:`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,colorspace_fragment:`gl_FragColor = linearToOutputTexel( gl_FragColor );`,colorspace_pars_fragment:`
const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,envmap_fragment:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,envmap_common_pars_fragment:`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,envmap_pars_fragment:`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,envmap_pars_vertex:`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,envmap_physical_pars_fragment:`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,envmap_vertex:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fog_vertex:`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,fog_pars_vertex:`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fog_fragment:`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,fog_pars_fragment:`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,gradientmap_pars_fragment:`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,lightmap_pars_fragment:`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lights_lambert_fragment:`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,lights_lambert_pars_fragment:`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,lights_pars_begin:`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,lights_toon_fragment:`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lights_toon_pars_fragment:`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lights_phong_fragment:`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lights_phong_pars_fragment:`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lights_physical_fragment:`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,lights_physical_pars_fragment:`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,lights_fragment_begin:`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lights_fragment_maps:`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,lights_fragment_end:`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,logdepthbuf_fragment:`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,logdepthbuf_pars_fragment:`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_pars_vertex:`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_vertex:`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,map_fragment:`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,map_pars_fragment:`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,map_particle_fragment:`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,map_particle_pars_fragment:`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,metalnessmap_fragment:`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,metalnessmap_pars_fragment:`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,morphinstance_vertex:`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,morphcolor_vertex:`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,morphnormal_vertex:`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,morphtarget_pars_vertex:`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,morphtarget_vertex:`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,normal_fragment_begin:`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,normal_fragment_maps:`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,normal_pars_fragment:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_pars_vertex:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_vertex:`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,normalmap_pars_fragment:`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,clearcoat_normal_fragment_begin:`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,clearcoat_normal_fragment_maps:`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,clearcoat_pars_fragment:`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,iridescence_pars_fragment:`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,opaque_fragment:`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,packing:`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,premultiplied_alpha_fragment:`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,project_vertex:`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dithering_fragment:`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,dithering_pars_fragment:`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,roughnessmap_fragment:`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,roughnessmap_pars_fragment:`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,shadowmap_pars_fragment:`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,shadowmap_pars_vertex:`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,shadowmap_vertex:`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,shadowmask_pars_fragment:`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,skinbase_vertex:`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,skinning_pars_vertex:`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,skinning_vertex:`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,skinnormal_vertex:`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,specularmap_fragment:`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,specularmap_pars_fragment:`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,tonemapping_fragment:`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,tonemapping_pars_fragment:`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,transmission_fragment:`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,transmission_pars_fragment:`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
		
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
		
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		
		#else
		
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,uv_pars_fragment:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_pars_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,worldpos_vertex:`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,background_vert:`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,background_frag:`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,backgroundCube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,backgroundCube_frag:`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,cube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,cube_frag:`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,depth_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,depth_frag:`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,distanceRGBA_vert:`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,distanceRGBA_frag:`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,equirect_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,equirect_frag:`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,linedashed_vert:`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,linedashed_frag:`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,meshbasic_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,meshbasic_frag:`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshlambert_vert:`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshlambert_frag:`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshmatcap_vert:`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,meshmatcap_frag:`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshnormal_vert:`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,meshnormal_frag:`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,meshphong_vert:`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshphong_frag:`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshphysical_vert:`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,meshphysical_frag:`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshtoon_vert:`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshtoon_frag:`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,points_vert:`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,points_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,shadow_vert:`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,shadow_frag:`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,sprite_vert:`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec2 scale;
	scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
	scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,sprite_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`},J={common:{diffuse:{value:new W(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new P},alphaMap:{value:null},alphaMapTransform:{value:new P},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new P}},envmap:{envMap:{value:null},envMapRotation:{value:new P},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new P}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new P}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new P},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new P},normalScale:{value:new N(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new P},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new P}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new P}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new P}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new W(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new W(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new P},alphaTest:{value:0},uvTransform:{value:new P}},sprite:{diffuse:{value:new W(16777215)},opacity:{value:1},center:{value:new N(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new P},alphaMap:{value:null},alphaMapTransform:{value:new P},alphaTest:{value:0}}},ir={basic:{uniforms:K([J.common,J.specularmap,J.envmap,J.aomap,J.lightmap,J.fog]),vertexShader:q.meshbasic_vert,fragmentShader:q.meshbasic_frag},lambert:{uniforms:K([J.common,J.specularmap,J.envmap,J.aomap,J.lightmap,J.emissivemap,J.bumpmap,J.normalmap,J.displacementmap,J.fog,J.lights,{emissive:{value:new W(0)}}]),vertexShader:q.meshlambert_vert,fragmentShader:q.meshlambert_frag},phong:{uniforms:K([J.common,J.specularmap,J.envmap,J.aomap,J.lightmap,J.emissivemap,J.bumpmap,J.normalmap,J.displacementmap,J.fog,J.lights,{emissive:{value:new W(0)},specular:{value:new W(1118481)},shininess:{value:30}}]),vertexShader:q.meshphong_vert,fragmentShader:q.meshphong_frag},standard:{uniforms:K([J.common,J.envmap,J.aomap,J.lightmap,J.emissivemap,J.bumpmap,J.normalmap,J.displacementmap,J.roughnessmap,J.metalnessmap,J.fog,J.lights,{emissive:{value:new W(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:q.meshphysical_vert,fragmentShader:q.meshphysical_frag},toon:{uniforms:K([J.common,J.aomap,J.lightmap,J.emissivemap,J.bumpmap,J.normalmap,J.displacementmap,J.gradientmap,J.fog,J.lights,{emissive:{value:new W(0)}}]),vertexShader:q.meshtoon_vert,fragmentShader:q.meshtoon_frag},matcap:{uniforms:K([J.common,J.bumpmap,J.normalmap,J.displacementmap,J.fog,{matcap:{value:null}}]),vertexShader:q.meshmatcap_vert,fragmentShader:q.meshmatcap_frag},points:{uniforms:K([J.points,J.fog]),vertexShader:q.points_vert,fragmentShader:q.points_frag},dashed:{uniforms:K([J.common,J.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:q.linedashed_vert,fragmentShader:q.linedashed_frag},depth:{uniforms:K([J.common,J.displacementmap]),vertexShader:q.depth_vert,fragmentShader:q.depth_frag},normal:{uniforms:K([J.common,J.bumpmap,J.normalmap,J.displacementmap,{opacity:{value:1}}]),vertexShader:q.meshnormal_vert,fragmentShader:q.meshnormal_frag},sprite:{uniforms:K([J.sprite,J.fog]),vertexShader:q.sprite_vert,fragmentShader:q.sprite_frag},background:{uniforms:{uvTransform:{value:new P},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:q.background_vert,fragmentShader:q.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new P}},vertexShader:q.backgroundCube_vert,fragmentShader:q.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:q.cube_vert,fragmentShader:q.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:q.equirect_vert,fragmentShader:q.equirect_frag},distanceRGBA:{uniforms:K([J.common,J.displacementmap,{referencePosition:{value:new I},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:q.distanceRGBA_vert,fragmentShader:q.distanceRGBA_frag},shadow:{uniforms:K([J.lights,J.fog,{color:{value:new W(0)},opacity:{value:1}}]),vertexShader:q.shadow_vert,fragmentShader:q.shadow_frag}};ir.physical={uniforms:K([ir.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new P},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new P},clearcoatNormalScale:{value:new N(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new P},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new P},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new P},sheen:{value:0},sheenColor:{value:new W(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new P},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new P},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new P},transmissionSamplerSize:{value:new N},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new P},attenuationDistance:{value:0},attenuationColor:{value:new W(0)},specularColor:{value:new W(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new P},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new P},anisotropyVector:{value:new N},anisotropyMap:{value:null},anisotropyMapTransform:{value:new P}}]),vertexShader:q.meshphysical_vert,fragmentShader:q.meshphysical_frag};var ar=(1+Math.sqrt(5))/2,or=1/ar;-ar,-or,-or;function sr(e,t,n){return!e||!n&&e.constructor===t?e:typeof t.BYTES_PER_ELEMENT==`number`?new t(e):Array.prototype.slice.call(e)}function cr(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}var lr=class{constructor(e,t,n,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r===void 0?new t.constructor(n):r,this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,r=t[n],i=t[n-1];validate_interval:{seek:{let a;linear_scan:{forward_scan:if(!(e<r)){for(let a=n+2;;){if(r===void 0){if(e<i)break forward_scan;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(i=r,r=t[++n],e<r)break seek}a=t.length;break linear_scan}if(!(e>=i)){let o=t[1];e<o&&(n=2,i=o);for(let a=n-2;;){if(i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===a)break;if(r=i,i=t[--n-1],e>=i)break seek}a=n,n=0;break linear_scan}break validate_interval}for(;n<a;){let r=n+a>>>1;e<t[r]?a=r:n=r+1}if(r=t[n],i=t[n-1],i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,i,r)}return this.interpolate_(n,i,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,r=this.valueSize,i=e*r;for(let e=0;e!==r;++e)t[e]=n[i+e];return t}interpolate_(){throw Error(`call to abstract method`)}intervalChanged_(){}},ur=class extends lr{constructor(e,t,n,r){super(e,t,n,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:We,endingEnd:We}}intervalChanged_(e,t,n){let r=this.parameterPositions,i=e-2,a=e+1,o=r[i],s=r[a];if(o===void 0)switch(this.getSettings_().endingStart){case Ge:i=e,o=2*t-n;break;case Ke:i=r.length-2,o=t+r[i]-r[i+1];break;default:i=e,o=n}if(s===void 0)switch(this.getSettings_().endingEnd){case Ge:a=e,s=2*n-t;break;case Ke:a=1,s=n+r[1]-r[0];break;default:a=e-1,s=t}let c=(n-t)*.5,l=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(s-n),this._offsetPrev=i*l,this._offsetNext=a*l}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,p=(n-t)/(r-t),m=p*p,h=m*p,g=-d*h+2*d*m-d*p,_=(1+d)*h+(-1.5-2*d)*m+(-.5+d)*p+1,v=(-1-f)*h+(1.5+f)*m+.5*p,y=f*h-f*m;for(let e=0;e!==o;++e)i[e]=g*a[l+e]+_*a[c+e]+v*a[s+e]+y*a[u+e];return i}},dr=class extends lr{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=(n-t)/(r-t),u=1-l;for(let e=0;e!==o;++e)i[e]=a[c+e]*u+a[s+e]*l;return i}},fr=class extends lr{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e){return this.copySampleValue_(e-1)}},pr=class{constructor(e,t,n,r){if(e===void 0)throw Error(`THREE.KeyframeTrack: track name is undefined`);if(t===void 0||t.length===0)throw Error(`THREE.KeyframeTrack: no keyframes in track named `+e);this.name=e,this.times=sr(t,this.TimeBufferType),this.values=sr(n,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:sr(e.times,Array),values:sr(e.values,Array)};let t=e.getInterpolation();t!==e.DefaultInterpolation&&(n.interpolation=t)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new fr(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new dr(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new ur(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Ve:t=this.InterpolantFactoryMethodDiscrete;break;case He:t=this.InterpolantFactoryMethodLinear;break;case Ue:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let t=`unsupported interpolation for `+this.ValueTypeName+` keyframe track named `+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw Error(t);return console.warn(`THREE.KeyframeTrack:`,t),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Ve;case this.InterpolantFactoryMethodLinear:return He;case this.InterpolantFactoryMethodSmooth:return Ue}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]*=e}return this}trim(e,t){let n=this.times,r=n.length,i=0,a=r-1;for(;i!==r&&n[i]<e;)++i;for(;a!==-1&&n[a]>t;)--a;if(++a,i!==0||a!==r){i>=a&&(a=Math.max(a,1),i=a-1);let e=this.getValueSize();this.times=n.slice(i,a),this.values=this.values.slice(i*e,a*e)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(console.error(`THREE.KeyframeTrack: Invalid value size in track.`,this),e=!1);let n=this.times,r=this.values,i=n.length;i===0&&(console.error(`THREE.KeyframeTrack: Track is empty.`,this),e=!1);let a=null;for(let t=0;t!==i;t++){let r=n[t];if(typeof r==`number`&&isNaN(r)){console.error(`THREE.KeyframeTrack: Time is not a valid number.`,this,t,r),e=!1;break}if(a!==null&&a>r){console.error(`THREE.KeyframeTrack: Out of order keys.`,this,t,r,a),e=!1;break}a=r}if(r!==void 0&&cr(r))for(let t=0,n=r.length;t!==n;++t){let n=r[t];if(isNaN(n)){console.error(`THREE.KeyframeTrack: Value is not a valid number.`,this,t,n),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),r=this.getInterpolation()===Ue,i=e.length-1,a=1;for(let o=1;o<i;++o){let i=!1,s=e[o];if(s!==e[o+1]&&(o!==1||s!==e[0]))if(r)i=!0;else{let e=o*n,r=e-n,a=e+n;for(let o=0;o!==n;++o){let n=t[e+o];if(n!==t[r+o]||n!==t[a+o]){i=!0;break}}}if(i){if(o!==a){e[a]=e[o];let r=o*n,i=a*n;for(let e=0;e!==n;++e)t[i+e]=t[r+e]}++a}}if(i>0){e[a]=e[i];for(let e=i*n,r=a*n,o=0;o!==n;++o)t[r+o]=t[e+o];++a}return a===e.length?(this.times=e,this.values=t):(this.times=e.slice(0,a),this.values=t.slice(0,a*n)),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,r=new n(this.name,e,t);return r.createInterpolant=this.createInterpolant,r}};pr.prototype.TimeBufferType=Float32Array,pr.prototype.ValueBufferType=Float32Array,pr.prototype.DefaultInterpolation=He;var mr=class extends pr{constructor(e,t,n){super(e,t,n)}};mr.prototype.ValueTypeName=`bool`,mr.prototype.ValueBufferType=Array,mr.prototype.DefaultInterpolation=Ve,mr.prototype.InterpolantFactoryMethodLinear=void 0,mr.prototype.InterpolantFactoryMethodSmooth=void 0;var hr=class extends pr{};hr.prototype.ValueTypeName=`color`;var gr=class extends pr{};gr.prototype.ValueTypeName=`number`;var _r=class extends lr{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=(n-t)/(r-t),c=e*o;for(let e=c+o;c!==e;c+=4)Ut.slerpFlat(i,0,a,c-o,a,c,s);return i}},vr=class extends pr{InterpolantFactoryMethodLinear(e){return new _r(this.times,this.values,this.getValueSize(),e)}};vr.prototype.ValueTypeName=`quaternion`,vr.prototype.InterpolantFactoryMethodSmooth=void 0;var yr=class extends pr{constructor(e,t,n){super(e,t,n)}};yr.prototype.ValueTypeName=`string`,yr.prototype.ValueBufferType=Array,yr.prototype.DefaultInterpolation=Ve,yr.prototype.InterpolantFactoryMethodLinear=void 0,yr.prototype.InterpolantFactoryMethodSmooth=void 0;var br=class extends pr{};br.prototype.ValueTypeName=`vector`;var xr=new class{constructor(e,t,n){let r=this,i=!1,a=0,o=0,s,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.itemStart=function(e){o++,i===!1&&r.onStart!==void 0&&r.onStart(e,a,o),i=!0},this.itemEnd=function(e){a++,r.onProgress!==void 0&&r.onProgress(e,a,o),a===o&&(i=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(e){r.onError!==void 0&&r.onError(e)},this.resolveURL=function(e){return s?s(e):e},this.setURLModifier=function(e){return s=e,this},this.addHandler=function(e,t){return c.push(e,t),this},this.removeHandler=function(e){let t=c.indexOf(e);return t!==-1&&c.splice(t,2),this},this.getHandler=function(e){for(let t=0,n=c.length;t<n;t+=2){let n=c[t],r=c[t+1];if(n.global&&(n.lastIndex=0),n.test(e))return r}return null}}},Sr=class{constructor(e){this.manager=e===void 0?xr:e,this.crossOrigin=`anonymous`,this.withCredentials=!1,this.path=``,this.resourcePath=``,this.requestHeader={}}load(){}loadAsync(e,t){let n=this;return new Promise(function(r,i){n.load(e,r,t,i)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}};Sr.DEFAULT_MATERIAL_NAME=`__DEFAULT`;var Cr=`\\[\\]\\.:\\/`,wr=RegExp(`[\\[\\]\\.:\\/]`,`g`),Tr=`[^\\[\\]\\.:\\/]`,Er=`[^`+Cr.replace(`\\.`,``)+`]`,Dr=`((?:WC+[\\/:])*)`.replace(`WC`,Tr),Or=`(WCOD+)?`.replace(`WCOD`,Er),kr=`(?:\\.(WC+)(?:\\[(.+)\\])?)?`.replace(`WC`,Tr),Ar=`\\.(WC+)(?:\\[(.+)\\])?`.replace(`WC`,Tr),jr=RegExp(`^`+Dr+Or+kr+Ar+`$`),Mr=[`material`,`materials`,`bones`,`map`],Nr=class{constructor(e,t,n){let r=n||Y.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,r=this._bindings[n];r!==void 0&&r.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let r=this._targetGroup.nCachedObjects_,i=n.length;r!==i;++r)n[r].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},Y=class e{constructor(t,n,r){this.path=n,this.parsedPath=r||e.parseTrackName(n),this.node=e.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,n,r){return t&&t.isAnimationObjectGroup?new e.Composite(t,n,r):new e(t,n,r)}static sanitizeNodeName(e){return e.replace(/\s/g,`_`).replace(wr,``)}static parseTrackName(e){let t=jr.exec(e);if(t===null)throw Error(`PropertyBinding: Cannot parse trackName: `+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=n.nodeName&&n.nodeName.lastIndexOf(`.`);if(r!==void 0&&r!==-1){let e=n.nodeName.substring(r+1);Mr.indexOf(e)!==-1&&(n.nodeName=n.nodeName.substring(0,r),n.objectName=e)}if(n.propertyName===null||n.propertyName.length===0)throw Error(`PropertyBinding: can not parse propertyName from trackName: `+e);return n}static findNode(e,t){if(t===void 0||t===``||t===`.`||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(e){for(let r=0;r<e.length;r++){let i=e[r];if(i.name===t||i.uuid===t)return i;let a=n(i.children);if(a)return a}return null},r=n(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)e[t++]=n[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let t=this.node,n=this.parsedPath,r=n.objectName,i=n.propertyName,a=n.propertyIndex;if(t||(t=e.findNode(this.rootNode,n.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){console.warn(`THREE.PropertyBinding: No target node found for track: `+this.path+`.`);return}if(r){let e=n.objectIndex;switch(r){case`materials`:if(!t.material){console.error(`THREE.PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.materials){console.error(`THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.`,this);return}t=t.material.materials;break;case`bones`:if(!t.skeleton){console.error(`THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.`,this);return}t=t.skeleton.bones;for(let n=0;n<t.length;n++)if(t[n].name===e){e=n;break}break;case`map`:if(`map`in t){t=t.map;break}if(!t.material){console.error(`THREE.PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.map){console.error(`THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.`,this);return}t=t.material.map;break;default:if(t[r]===void 0){console.error(`THREE.PropertyBinding: Can not bind to objectName of node undefined.`,this);return}t=t[r]}if(e!==void 0){if(t[e]===void 0){console.error(`THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.`,this,t);return}t=t[e]}}let o=t[i];if(o===void 0){let e=n.nodeName;console.error(`THREE.PropertyBinding: Trying to update property for track: `+e+`.`+i+` but it wasn't found.`,t);return}let s=this.Versioning.None;this.targetObject=t,t.needsUpdate===void 0?t.matrixWorldNeedsUpdate!==void 0&&(s=this.Versioning.MatrixWorldNeedsUpdate):s=this.Versioning.NeedsUpdate;let c=this.BindingType.Direct;if(a!==void 0){if(i===`morphTargetInfluences`){if(!t.geometry){console.error(`THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.`,this);return}if(!t.geometry.morphAttributes){console.error(`THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.`,this);return}t.morphTargetDictionary[a]!==void 0&&(a=t.morphTargetDictionary[a])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=a}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][s]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};Y.Composite=Nr,Y.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3},Y.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2},Y.prototype.GetterByBindingType=[Y.prototype._getValue_direct,Y.prototype._getValue_array,Y.prototype._getValue_arrayElement,Y.prototype._getValue_toArray],Y.prototype.SetterByBindingTypeAndVersioning=[[Y.prototype._setValue_direct,Y.prototype._setValue_direct_setNeedsUpdate,Y.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Y.prototype._setValue_array,Y.prototype._setValue_array_setNeedsUpdate,Y.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Y.prototype._setValue_arrayElement,Y.prototype._setValue_arrayElement_setNeedsUpdate,Y.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Y.prototype._setValue_fromArray,Y.prototype._setValue_fromArray_setNeedsUpdate,Y.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Pr=class{constructor(e=1,t=0,n=0){return this.radius=e,this.phi=t,this.theta=n,this}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){let e=1e-6;return this.phi=Math.max(e,Math.min(Math.PI-e,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(M(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}},Fr=class extends tt{constructor(e,t){super(),this.object=e,this.domElement=t,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(){}disconnect(){}dispose(){}update(){}};typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`register`,{detail:{revision:`168`}})),typeof window<`u`&&(window.__THREE__?console.warn(`WARNING: Multiple instances of Three.js being imported.`):window.__THREE__=`168`);var Ir={type:`change`},Lr={type:`start`},Rr={type:`end`},zr=new gn,Br=new er,Vr=Math.cos(70*Et.DEG2RAD),X=new I,Z=2*Math.PI,Q={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},Hr=1e-6,Ur=class extends Fr{constructor(e,t=null){super(e,t),this.state=Q.NONE,this.enabled=!0,this.target=new I,this.cursor=new I,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:`ArrowLeft`,UP:`ArrowUp`,RIGHT:`ArrowRight`,BOTTOM:`ArrowDown`},this.mouseButtons={LEFT:Me.ROTATE,MIDDLE:Me.DOLLY,RIGHT:Me.PAN},this.touches={ONE:Ne.ROTATE,TWO:Ne.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this._lastPosition=new I,this._lastQuaternion=new Ut,this._lastTargetPosition=new I,this._quat=new Ut().setFromUnitVectors(e.up,new I(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Pr,this._sphericalDelta=new Pr,this._scale=1,this._panOffset=new I,this._rotateStart=new N,this._rotateEnd=new N,this._rotateDelta=new N,this._panStart=new N,this._panEnd=new N,this._panDelta=new N,this._dollyStart=new N,this._dollyEnd=new N,this._dollyDelta=new N,this._dollyDirection=new I,this._mouse=new N,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Gr.bind(this),this._onPointerDown=Wr.bind(this),this._onPointerUp=Kr.bind(this),this._onContextMenu=$r.bind(this),this._onMouseWheel=Yr.bind(this),this._onKeyDown=Xr.bind(this),this._onTouchStart=Zr.bind(this),this._onTouchMove=Qr.bind(this),this._onMouseDown=qr.bind(this),this._onMouseMove=Jr.bind(this),this._interceptControlDown=ei.bind(this),this._interceptControlUp=ti.bind(this),this.domElement!==null&&this.connect(),this.update()}connect(){this.domElement.addEventListener(`pointerdown`,this._onPointerDown),this.domElement.addEventListener(`pointercancel`,this._onPointerUp),this.domElement.addEventListener(`contextmenu`,this._onContextMenu),this.domElement.addEventListener(`wheel`,this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener(`keydown`,this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction=`none`}disconnect(){this.domElement.removeEventListener(`pointerdown`,this._onPointerDown),this.domElement.removeEventListener(`pointermove`,this._onPointerMove),this.domElement.removeEventListener(`pointerup`,this._onPointerUp),this.domElement.removeEventListener(`pointercancel`,this._onPointerUp),this.domElement.removeEventListener(`wheel`,this._onMouseWheel),this.domElement.removeEventListener(`contextmenu`,this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener(`keydown`,this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction=`auto`}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener(`keydown`,this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener(`keydown`,this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(Ir),this.update(),this.state=Q.NONE}update(e=null){let t=this.object.position;X.copy(t).sub(this.target),X.applyQuaternion(this._quat),this._spherical.setFromVector3(X),this.autoRotate&&this.state===Q.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let n=this.minAzimuthAngle,r=this.maxAzimuthAngle;isFinite(n)&&isFinite(r)&&(n<-Math.PI?n+=Z:n>Math.PI&&(n-=Z),r<-Math.PI?r+=Z:r>Math.PI&&(r-=Z),n<=r?this._spherical.theta=Math.max(n,Math.min(r,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(n+r)/2?Math.max(n,this._spherical.theta):Math.min(r,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let i=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{let e=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),i=e!=this._spherical.radius}if(X.setFromSpherical(this._spherical),X.applyQuaternion(this._quatInverse),t.copy(this.target).add(X),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let e=null;if(this.object.isPerspectiveCamera){let t=X.length();e=this._clampDistance(t*this._scale);let n=t-e;this.object.position.addScaledVector(this._dollyDirection,n),this.object.updateMatrixWorld(),i=!!n}else if(this.object.isOrthographicCamera){let t=new I(this._mouse.x,this._mouse.y,0);t.unproject(this.object);let n=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),i=n!==this.object.zoom;let r=new I(this._mouse.x,this._mouse.y,0);r.unproject(this.object),this.object.position.sub(r).add(t),this.object.updateMatrixWorld(),e=X.length()}else console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled.`),this.zoomToCursor=!1;e!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(e).add(this.object.position):(zr.origin.copy(this.object.position),zr.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(zr.direction))<Vr?this.object.lookAt(this.target):(Br.setFromNormalAndCoplanarPoint(this.object.up,this.target),zr.intersectPlane(Br,this.target))))}else if(this.object.isOrthographicCamera){let e=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),e!==this.object.zoom&&(this.object.updateProjectionMatrix(),i=!0)}return this._scale=1,this._performCursorZoom=!1,i||this._lastPosition.distanceToSquared(this.object.position)>Hr||8*(1-this._lastQuaternion.dot(this.object.quaternion))>Hr||this._lastTargetPosition.distanceToSquared(this.target)>Hr?(this.dispatchEvent(Ir),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e===null?Z/60/60*this.autoRotateSpeed:Z/60*this.autoRotateSpeed*e}_getZoomScale(e){let t=Math.abs(e*.01);return .95**(this.zoomSpeed*t)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,t){X.setFromMatrixColumn(t,0),X.multiplyScalar(-e),this._panOffset.add(X)}_panUp(e,t){this.screenSpacePanning===!0?X.setFromMatrixColumn(t,1):(X.setFromMatrixColumn(t,0),X.crossVectors(this.object.up,X)),X.multiplyScalar(e),this._panOffset.add(X)}_pan(e,t){let n=this.domElement;if(this.object.isPerspectiveCamera){let r=this.object.position;X.copy(r).sub(this.target);let i=X.length();i*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*i/n.clientHeight,this.object.matrix),this._panUp(2*t*i/n.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/n.clientWidth,this.object.matrix),this._panUp(t*(this.object.top-this.object.bottom)/this.object.zoom/n.clientHeight,this.object.matrix)):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.`),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),this.enableZoom=!1)}_updateZoomParameters(e,t){if(!this.zoomToCursor)return;this._performCursorZoom=!0;let n=this.domElement.getBoundingClientRect(),r=e-n.left,i=t-n.top,a=n.width,o=n.height;this._mouse.x=r/a*2-1,this._mouse.y=-(i/o)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let t=this.domElement;this._rotateLeft(Z*this._rotateDelta.x/t.clientHeight),this._rotateUp(Z*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let t=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateUp(Z*this.rotateSpeed/this.domElement.clientHeight):this._pan(0,this.keyPanSpeed),t=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateUp(-Z*this.rotateSpeed/this.domElement.clientHeight):this._pan(0,-this.keyPanSpeed),t=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateLeft(Z*this.rotateSpeed/this.domElement.clientHeight):this._pan(this.keyPanSpeed,0),t=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this._rotateLeft(-Z*this.rotateSpeed/this.domElement.clientHeight):this._pan(-this.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._rotateStart.set(n,r)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._panStart.set(n,r)}}_handleTouchStartDolly(e){let t=this._getSecondPointerPosition(e),n=e.pageX-t.x,r=e.pageY-t.y,i=Math.sqrt(n*n+r*r);this._dollyStart.set(0,i)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._rotateEnd.set(n,r)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let t=this.domElement;this._rotateLeft(Z*this._rotateDelta.x/t.clientHeight),this._rotateUp(Z*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._panEnd.set(n,r)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){let t=this._getSecondPointerPosition(e),n=e.pageX-t.x,r=e.pageY-t.y,i=Math.sqrt(n*n+r*r);this._dollyEnd.set(0,i),this._dollyDelta.set(0,(this._dollyEnd.y/this._dollyStart.y)**+this.zoomSpeed),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);let a=(e.pageX+t.x)*.5,o=(e.pageY+t.y)*.5;this._updateZoomParameters(a,o)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId){this._pointers.splice(t,1);return}}_isTrackingPointer(e){for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId)return!0;return!1}_trackPointer(e){let t=this._pointerPositions[e.pointerId];t===void 0&&(t=new N,this._pointerPositions[e.pointerId]=t),t.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){let t=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[t]}_customWheelEvent(e){let t=e.deltaMode,n={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(t){case 1:n.deltaY*=16;break;case 2:n.deltaY*=100;break}return e.ctrlKey&&!this._controlActive&&(n.deltaY*=10),n}};function Wr(e){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(e.pointerId),this.domElement.addEventListener(`pointermove`,this._onPointerMove),this.domElement.addEventListener(`pointerup`,this._onPointerUp)),!this._isTrackingPointer(e)&&(this._addPointer(e),e.pointerType===`touch`?this._onTouchStart(e):this._onMouseDown(e)))}function Gr(e){this.enabled!==!1&&(e.pointerType===`touch`?this._onTouchMove(e):this._onMouseMove(e))}function Kr(e){switch(this._removePointer(e),this._pointers.length){case 0:this.domElement.releasePointerCapture(e.pointerId),this.domElement.removeEventListener(`pointermove`,this._onPointerMove),this.domElement.removeEventListener(`pointerup`,this._onPointerUp),this.dispatchEvent(Rr),this.state=Q.NONE;break;case 1:let t=this._pointers[0],n=this._pointerPositions[t];this._onTouchStart({pointerId:t,pageX:n.x,pageY:n.y});break}}function qr(e){let t;switch(e.button){case 0:t=this.mouseButtons.LEFT;break;case 1:t=this.mouseButtons.MIDDLE;break;case 2:t=this.mouseButtons.RIGHT;break;default:t=-1}switch(t){case Me.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(e),this.state=Q.DOLLY;break;case Me.ROTATE:if(e.ctrlKey||e.metaKey||e.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(e),this.state=Q.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(e),this.state=Q.ROTATE}break;case Me.PAN:if(e.ctrlKey||e.metaKey||e.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(e),this.state=Q.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(e),this.state=Q.PAN}break;default:this.state=Q.NONE}this.state!==Q.NONE&&this.dispatchEvent(Lr)}function Jr(e){switch(this.state){case Q.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(e);break;case Q.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(e);break;case Q.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(e);break}}function Yr(e){this.enabled===!1||this.enableZoom===!1||this.state!==Q.NONE||(e.preventDefault(),this.dispatchEvent(Lr),this._handleMouseWheel(this._customWheelEvent(e)),this.dispatchEvent(Rr))}function Xr(e){this.enabled===!1||this.enablePan===!1||this._handleKeyDown(e)}function Zr(e){switch(this._trackPointer(e),this._pointers.length){case 1:switch(this.touches.ONE){case Ne.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(e),this.state=Q.TOUCH_ROTATE;break;case Ne.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(e),this.state=Q.TOUCH_PAN;break;default:this.state=Q.NONE}break;case 2:switch(this.touches.TWO){case Ne.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(e),this.state=Q.TOUCH_DOLLY_PAN;break;case Ne.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(e),this.state=Q.TOUCH_DOLLY_ROTATE;break;default:this.state=Q.NONE}break;default:this.state=Q.NONE}this.state!==Q.NONE&&this.dispatchEvent(Lr)}function Qr(e){switch(this._trackPointer(e),this.state){case Q.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(e),this.update();break;case Q.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(e),this.update();break;case Q.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(e),this.update();break;case Q.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(e),this.update();break;default:this.state=Q.NONE}}function $r(e){this.enabled!==!1&&e.preventDefault()}function ei(e){e.key===`Control`&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener(`keyup`,this._interceptControlUp,{passive:!0,capture:!0}))}function ti(e){e.key===`Control`&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener(`keyup`,this._interceptControlUp,{passive:!0,capture:!0}))}var ni=`// points-depth.wgsl
// Single 2D dispatch covers all visible chunks in one GPU call.
//
// gid.y = index into visibleSlots[], which maps to a uniformIdx into
// the chunks[] storage array. gid.x = point index within that chunk.
// The host builds visibleSlots on CPU (frustum cull), writes it via
// writeBuffer, then calls dispatchWorkgroups(maxWG, visibleCount, 1).
//
// For each point:
//  1. Unpack Int16 quantized x,y,z (sign-extended from u32 halves)
//  2. Dequantize: worldPos = ((q + 32768) / 65535) * range + min
//  3. Subtract sceneCenter (Float32 stability)
//  4. Project via viewProj matrix
//  5. Discard if outside clip volume (per-point frustum cull)
//  6. atomicMin on depth buffer with bit-cast(ndc.z) — order-preserving
//     for positive floats in [0,1]
//  7. If we won the race, compute final color from colorParams.mode and
//     write to color buffer. Race tolerated.

struct CameraUniform {
    viewProj:     mat4x4<f32>,
    viewportSize: vec2<f32>,
    _pad0:        vec2<f32>,
    sceneCenter:  vec3<f32>,
    splatRadius:  f32,
};

struct ChunkUniform {
    minXYZ: vec3<f32>,
    pointCount: u32,
    rangeXYZ: vec3<f32>,
    pointStrideOffset: u32,   // offset (in u32s) into \`points\` where this chunk starts
};

// colorParams.mode values:
//   0 = rgb          (native color from word 2)
//   1 = height       (shader-computed elevation ramp)
//   2 = intensity    (grayscale from seed-stretched intensity8)
//   3 = classification (ASPRS LUT)
struct ColorParams {
    mode        : u32,
    _pad0       : u32,
    globalMinZ  : f32,
    globalMaxZ  : f32,
    intensityLo : f32,  // identity 0.0 for v1; hook for in-flight histogram refinement
    intensityHi : f32,  // identity 1.0 for v1
    _pad1       : vec2<f32>,
};

@group(0) @binding(0) var<uniform>             camera:       CameraUniform;
@group(0) @binding(1) var<storage, read>       chunks:       array<ChunkUniform>;
@group(0) @binding(2) var<storage, read>       points:       array<u32>;
@group(0) @binding(3) var<storage, read_write> depthBuffer:  array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> colorBuffer:  array<u32>;
@group(0) @binding(5) var<storage, read>       visibleSlots: array<u32>;
// Pick-ID buffer (T2 picking). Inactive = 4-byte stub; OOB writes are silently dropped by WebGPU.
// Encoding: bits 31..19 = uniformIdx (slot in chunks[]), bits 18..0 = local point index.
// Sentinel 0xFFFFFFFF = no point (matches depth sentinel).
@group(0) @binding(6) var<storage, read_write> pickBuffer:   array<u32>;
@group(0) @binding(7) var<uniform>             colorParams:  ColorParams;
@group(0) @binding(8) var<storage, read>       classLUT:     array<u32, 256>;

fn unpackI16(packed: u32, half: u32) -> i32 {
    let raw = (packed >> (half * 16u)) & 0xFFFFu;
    if ((raw & 0x8000u) != 0u) {
        return i32(raw | 0xFFFF0000u);
    }
    return i32(raw);
}

// WGSL port of the TS elevationToRgb ramp in decode-worker.ts.
// Must stay in sync with the worker's copy — both implement the same 5-stop gradient.
fn heightRamp(t: f32) -> vec3<f32> {
    let c0 = vec3<f32>(  0.0,  51.0, 204.0) / 255.0;
    let c1 = vec3<f32>(  0.0, 204.0, 153.0) / 255.0;
    let c2 = vec3<f32>( 51.0, 230.0,  26.0) / 255.0;
    let c3 = vec3<f32>(255.0, 204.0,   0.0) / 255.0;
    let c4 = vec3<f32>(255.0,  26.0,   0.0) / 255.0;

    let clamped = clamp(t, 0.0, 0.9999);
    let idx = clamped * 4.0;
    let lo  = i32(floor(idx));
    let hi  = min(lo + 1, 4);
    let f   = idx - floor(idx);

    var stops = array<vec3<f32>, 5>(c0, c1, c2, c3, c4);
    return mix(stops[lo], stops[hi], f);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let uniformIdx = visibleSlots[gid.y];
    let chunk      = chunks[uniformIdx];
    let pointIdx   = gid.x;
    if (pointIdx >= chunk.pointCount) { return; }

    let base = chunk.pointStrideOffset + pointIdx * 3u;
    let w0   = points[base + 0u];
    let w1   = points[base + 1u];
    let w2   = points[base + 2u];

    let qx = unpackI16(w0, 0u);
    let qy = unpackI16(w0, 1u);
    let qz = unpackI16(w1, 0u);

    let normalized = (vec3<f32>(f32(qx), f32(qy), f32(qz)) + vec3<f32>(32768.0)) / 65535.0;
    let worldPos = normalized * chunk.rangeXYZ + chunk.minXYZ;
    let localPos = worldPos - camera.sceneCenter;

    let clip = camera.viewProj * vec4<f32>(localPos, 1.0);
    if (clip.w <= 0.0) { return; }

    let ndc = clip.xyz / clip.w;
    if (ndc.x < -1.0 || ndc.x > 1.0) { return; }
    if (ndc.y < -1.0 || ndc.y > 1.0) { return; }
    if (ndc.z <  0.0 || ndc.z > 1.0) { return; }

    let viewportW = camera.viewportSize.x;
    let viewportH = camera.viewportSize.y;
    let fx = (ndc.x * 0.5 + 0.5) * viewportW;
    let fy = (1.0 - (ndc.y * 0.5 + 0.5)) * viewportH;
    let px = u32(fx);
    let py = u32(fy);
    if (px >= u32(viewportW)) { return; }
    if (py >= u32(viewportH)) { return; }

    let depthBits = bitcast<u32>(ndc.z);
    // Encode (uniformIdx, pointIdx) for T2 picking. Same race profile as colorBuffer:
    // written only in the atomicMin win-branch, benign sub-pixel margin error accepted.
    let encodedId = (uniformIdx << 19u) | pointIdx;
    let radius = i32(camera.splatRadius) - 1;
    let vpW = i32(viewportW);
    let vpH = i32(viewportH);

    // ── Compute final color from colorParams.mode ──────────────────────────────
    let intensity8 = (w1 >> 16u) & 0xFFu;
    let classv     = (w1 >> 24u) & 0xFFu;
    let nr = f32( w2        & 0xFFu) / 255.0;
    let ng = f32((w2 >>  8u) & 0xFFu) / 255.0;
    let nb = f32((w2 >> 16u) & 0xFFu) / 255.0;

    var rgb: vec3<f32>;
    switch colorParams.mode {
        case 1u: {
            let globalRangeZ = max(colorParams.globalMaxZ - colorParams.globalMinZ, 1e-6);
            let t = clamp((worldPos.z - colorParams.globalMinZ) / globalRangeZ, 0.0, 1.0);
            rgb = heightRamp(t);
        }
        case 2u: {
            var iv = f32(intensity8) / 255.0;
            let iRange = max(colorParams.intensityHi - colorParams.intensityLo, 1e-6);
            iv = clamp((iv - colorParams.intensityLo) / iRange, 0.0, 1.0);
            rgb = vec3<f32>(iv, iv, iv);
        }
        case 3u: {
            let p = classLUT[classv];
            rgb = vec3<f32>(f32(p & 0xFFu), f32((p >> 8u) & 0xFFu), f32((p >> 16u) & 0xFFu)) / 255.0;
        }
        default: {
            rgb = vec3<f32>(nr, ng, nb);
        }
    }

    let r255 = u32(clamp(rgb.x * 255.0, 0.0, 255.0));
    let g255 = u32(clamp(rgb.y * 255.0, 0.0, 255.0));
    let b255 = u32(clamp(rgb.z * 255.0, 0.0, 255.0));
    let finalColor = (0xFFu << 24u) | (b255 << 16u) | (g255 << 8u) | r255;

    for (var dy: i32 = -radius; dy <= radius; dy++) {
        for (var dx: i32 = -radius; dx <= radius; dx++) {
            let sx = i32(px) + dx;
            let sy = i32(py) + dy;
            if (sx < 0 || sy < 0 || sx >= vpW || sy >= vpH) { continue; }
            let idx = u32(sy) * u32(vpW) + u32(sx);
            let prev = atomicMin(&depthBuffer[idx], depthBits);
            if (depthBits < prev) {
                colorBuffer[idx] = finalColor;
                pickBuffer[idx]  = encodedId;
            }
        }
    }
}
`,ri=`// clear-depth.wgsl
// Resets the depth buffer to 0xFFFFFFFF — the "no point" sentinel — each frame.
//
// We can't use commandEncoder.clearBuffer() because that fills with zeros,
// and we need a sentinel that is greater than any valid depth bit-cast (which
// for floats in [0,1] is at most 0x3F800000). 0xFFFFFFFF works perfectly as
// the initial atomicMin value.
//
// The color buffer doesn't need this — it can stay garbage between frames
// because the resolve pass only reads pixels whose depth != 0xFFFFFFFF.
//
// The pick buffer (binding 1) is reset to the same sentinel each frame.
// When picking is inactive the pick buffer is a 4-byte stub; arrayLength()
// returns 1 so only element 0 is touched — no out-of-bounds writes.

@group(0) @binding(0) var<storage, read_write> depthBuffer: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> pickBuffer:  array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= arrayLength(&depthBuffer)) { return; }
    atomicStore(&depthBuffer[idx], 0xFFFFFFFFu);
    if (idx < arrayLength(&pickBuffer)) {
        pickBuffer[idx] = 0xFFFFFFFFu;
    }
}
`,ii=`// resolve-edl.wgsl
// Fullscreen triangle that reads the per-pixel depth and color buffers and
// writes to the swapchain texture, applying eye-dome lighting (EDL) inline.
//
// EDL (Christian Boucheny, 2009) attenuates pixel brightness by the sum of
// positive log-depth differences against 4 neighbors. Pixels at the "front"
// of a discontinuity get darkened, giving point clouds visible structure
// without explicit shading.
//
// Sentinel: 0xFFFFFFFF in the depth buffer means "no point hit this pixel"
// (atomicMin against the initial 0xFFFFFFFF is replaced by any valid depth
// since IEEE-754 positive floats in [0,1] all bit-cast to values < 0xFFFFFFFF).

struct ViewportUniform {
    size: vec2<f32>,
    edlStrength: f32,
    edlRadius: f32,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;
@group(0) @binding(1) var<storage, read> depthBuffer: array<u32>;
@group(0) @binding(2) var<storage, read> colorBuffer: array<u32>;

const EMPTY_DEPTH: u32 = 0xFFFFFFFFu;
const BACKGROUND: vec3<f32> = vec3<f32>(0.04, 0.04, 0.06);

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
    // Fullscreen triangle: covers NDC [-1, 3] x [-1, 3] which clips to [-1, 1].
    let x = f32((idx << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(idx & 2u) * 2.0 - 1.0;
    return vec4<f32>(x, y, 0.0, 1.0);
}

fn readDepth(px: i32, py: i32, w: i32, h: i32) -> f32 {
    if (px < 0 || py < 0 || px >= w || py >= h) { return -1.0; }
    let bits = depthBuffer[py * w + px];
    if (bits == EMPTY_DEPTH) { return -1.0; }
    return bitcast<f32>(bits);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let w = i32(viewport.size.x);
    let h = i32(viewport.size.y);
    let px = i32(fragCoord.x);
    let py = i32(fragCoord.y);
    if (px < 0 || py < 0 || px >= w || py >= h) {
        return vec4<f32>(BACKGROUND, 1.0);
    }

    let centerDepth = readDepth(px, py, w, h);
    if (centerDepth < 0.0) {
        return vec4<f32>(BACKGROUND, 1.0);
    }

    // log(z + epsilon) to make EDL sensitive to relative depth differences
    // regardless of overall scene distance.
    let logCenter = log2(centerDepth + 1e-6);

    let r = i32(max(1.0, viewport.edlRadius));
    var shade = 0.0;
    // 4 cardinal neighbors at radius r — Potree's standard EDL kernel.
    let offsets = array<vec2<i32>, 4>(
        vec2<i32>(-r, 0),
        vec2<i32>( r, 0),
        vec2<i32>(0, -r),
        vec2<i32>(0,  r),
    );
    for (var i = 0; i < 4; i = i + 1) {
        let nx = px + offsets[i].x;
        let ny = py + offsets[i].y;
        let nd = readDepth(nx, ny, w, h);
        if (nd < 0.0) { continue; }
        let dz = logCenter - log2(nd + 1e-6);
        shade = shade + max(0.0, dz);
    }
    let factor = exp(-shade * viewport.edlStrength);

    let rgba = colorBuffer[py * w + px];
    let cr = f32(rgba & 0xFFu)         / 255.0;
    let cg = f32((rgba >>  8u) & 0xFFu) / 255.0;
    let cb = f32((rgba >> 16u) & 0xFFu) / 255.0;
    return vec4<f32>(cr * factor, cg * factor, cb * factor, 1.0);
}
`,ai=class extends Error{constructor(e){super(e),this.name=`WebGPUUnsupportedError`}},oi=128*1024*1024,si=2*1024*1024*1024,ci=4096*7e5;async function li(e,t={}){let n=t.targetCapacityBytes??si;if(n<oi&&(console.warn(`[webgpu] targetCapacityBytes ${n} below floor ${oi}; clamping to floor`),n=oi),n>ci&&(console.warn(`[webgpu] targetCapacityBytes ${n} exceeds MAX_SLOTS-aware ceiling ${ci} (~2.87 GB); clamping. To go higher, bump MAX_SLOTS in webgpu-renderer.ts first.`),n=ci),!(`gpu`in navigator))throw new ai(`navigator.gpu not available — WebGPU disabled or unsupported in this browser`);let r=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!r)throw new ai(`navigator.gpu.requestAdapter() returned null — no compatible GPU found`);let i=r.limits.maxStorageBufferBindingSize,a=r.limits.maxBufferSize,o=Math.min(i,n),s=Math.min(a,n),c;try{c=await r.requestDevice({requiredLimits:{maxStorageBufferBindingSize:o,maxBufferSize:s}})}catch(e){console.warn(`[webgpu] device rejected expanded storage limits — falling back to defaults:`,e),c=await r.requestDevice()}let l=c.limits.maxStorageBufferBindingSize,u=c.limits.maxBufferSize,d=Math.min(l,u,n);if(d<oi)throw new ai(`Device storage buffer limit too small: ${d} < ${oi} (integrated GPU with restricted limits; try a discrete GPU)`);console.debug(`[webgpu] negotiated context:`,{adapterMaxStorageMB:Math.round(i/1024/1024),adapterMaxBufferMB:Math.round(a/1024/1024),deviceMaxStorageMB:Math.round(l/1024/1024),deviceMaxBufferMB:Math.round(u/1024/1024),ringBufferCapacityMB:Math.round(d/1024/1024),requestedTargetMB:Math.round(n/1024/1024)});let f=e.getContext(`webgpu`);if(!f)throw new ai(`canvas.getContext("webgpu") returned null — WebGPU not available on this canvas`);let p=navigator.gpu.getPreferredCanvasFormat();return f.configure({device:c,format:p,alphaMode:`premultiplied`}),{device:c,context:f,canvas:e,canvasFormat:p,ringBufferCapacity:d,limits:{adapterMaxStorageBufferBindingSize:i,adapterMaxBufferSize:a,deviceMaxStorageBufferBindingSize:l,deviceMaxBufferSize:u}}}var ui=800*1024,di=class{capacity;slots=new Map;freeList;allocCount=0;allocBytesTotal=0;constructor(e){this.capacity=e,this.freeList=[{offset:0,length:e}]}allocate(e,t,n,r,i,a){if(t%4!=0)throw Error(`RingBufferAllocator: byteLength ${t} not multiple of 4`);if(t>this.capacity)return console.warn(`[ring-buffer] chunk ${e} byteLength ${t} B exceeds total capacity ${this.capacity} B — rejected permanently`),null;let o=this.slots.get(e);if(o)return o.lastRenderedFrame=Math.max(o.lastRenderedFrame,a-1),{slot:o,evicted:[]};let s=[];for(;;){let o=this.findFirstFit(t);if(o!==-1){let c=this.freeList[o],l=c.offset;c.length===t?this.freeList.splice(o,1):(c.offset+=t,c.length-=t);let u={chunkIndex:e,byteOffset:l,byteLength:t,pointCount:n,min:r,range:i,lastRenderedFrame:a-1,everRendered:!1};return this.slots.set(e,u),this.allocCount++,this.allocBytesTotal+=t,{slot:u,evicted:s}}let c=this.findLRUEvictableKey(a);if(c===null)return{slot:null,evicted:s};s.push(this.slots.get(c)),this.doRemove(c)}}findFirstFit(e){for(let t=0;t<this.freeList.length;t++)if(this.freeList[t].length>=e)return t;return-1}findLRUEvictableKey(e){let t=null,n=1/0;for(let[r,i]of this.slots)i.lastRenderedFrame>=e||i.lastRenderedFrame<n&&(n=i.lastRenderedFrame,t=r);return t}doRemove(e){let t=this.slots.get(e);this.slots.delete(e),this.freeList.push({offset:t.byteOffset,length:t.byteLength}),this.coalesceFreeList()}coalesceFreeList(){if(this.freeList.length<=1)return;this.freeList.sort((e,t)=>e.offset-t.offset);let e=[];for(let t of this.freeList){let n=e.at(-1);n&&n.offset+n.length>=t.offset?n.length=Math.max(n.length,t.offset+t.length-n.offset):e.push({offset:t.offset,length:t.length})}this.freeList=e}touch(e,t){let n=this.slots.get(e);n&&(n.lastRenderedFrame=t,n.everRendered=!0)}getSlot(e){return this.slots.get(e)}remove(e){return this.slots.has(e)?(this.doRemove(e),!0):!1}clear(){this.slots.clear(),this.freeList=[{offset:0,length:this.capacity}],this.allocCount=0,this.allocBytesTotal=0}getSlots(){return[...this.slots.values()]}bytesUsed(){let e=0;for(let t of this.slots.values())e+=t.byteLength;return e}pointsLoaded(){let e=0;for(let t of this.slots.values())e+=t.pointCount;return e}avgChunkBytes(){return this.allocCount>0?this.allocBytesTotal/this.allocCount:ui}getAvailableCount(e){let t=this.avgChunkBytes(),n=0;for(let t of this.slots.values())t.lastRenderedFrame<e&&(n+=t.byteLength);let r=0;for(let e of this.freeList)r+=e.length;return Math.floor((n+r)/t)}metrics(){let e=0;for(let t of this.slots.values())e+=t.byteLength;let t=0,n=0;for(let e of this.freeList)t+=e.length,e.length>n&&(n=e.length);let r=t>0?(t-n)/t:0;return{capacity:this.capacity,chunkCount:this.slots.size,bytesUsed:e,bytesFree:t,largestFreeGap:n,fragmentationRatio:r,avgChunkBytes:this.avgChunkBytes()}}};function fi(e){let{positions:t,colors:n,classification:r,intensity8:i,pointCount:a}=e,o=new Uint32Array(a*3);for(let e=0;e<a;e++){let a=t[e*3+0]&65535,s=t[e*3+1]&65535,c=t[e*3+2]&65535,l=r?r[e]:0,u=i?i[e]:0,d=n[e*4+0],f=n[e*4+1],p=n[e*4+2],m=n[e*4+3];o[e*3+0]=s<<16|a,o[e*3+1]=(l<<24|u<<16|c)>>>0,o[e*3+2]=(m<<24|p<<16|f<<8|d)>>>0}return o}function pi(e){if(e.length===0)return{packed:new Uint32Array,pointCount:0,min:[0,0,0],range:[1,1,1]};let t=1/0,n=1/0,r=1/0,i=-1/0,a=-1/0,o=-1/0;for(let s of e)s.x<t&&(t=s.x),s.y<n&&(n=s.y),s.z<r&&(r=s.z),s.x>i&&(i=s.x),s.y>a&&(a=s.y),s.z>o&&(o=s.z);let s=i-t||1,c=a-n||1,l=o-r||1,u=new Uint32Array(e.length*3);for(let i=0;i<e.length;i++){let a=e[i],o=Math.round((a.x-t)/s*65535-32768)&65535,d=Math.round((a.y-n)/c*65535-32768)&65535,f=Math.round((a.z-r)/l*65535-32768)&65535,p=(a.z-r)/l,m=Math.max(0,Math.min(255,Math.round(40+p*215))),h=Math.max(0,Math.min(255,Math.round(60+(1-Math.abs(p-.5)*2)*120))),g=Math.max(0,Math.min(255,Math.round(220-p*200)));u[i*3+0]=d<<16|o,u[i*3+1]=f,u[i*3+2]=(255<<24|g<<16|h<<8|m)>>>0}return{packed:u,pointCount:e.length,min:[t,n,r],range:[s,c,l]}}function $(e,t,n){return(255<<24|n<<16|t<<8|e)>>>0}var mi=(()=>{let e=new Uint32Array(256);return e.fill($(150,150,150)),e[0]=$(160,160,160),e[1]=$(200,200,200),e[2]=$(160,120,70),e[3]=$(120,200,90),e[4]=$(60,170,60),e[5]=$(30,120,30),e[6]=$(240,120,60),e[7]=$(255,0,255),e[9]=$(50,130,230),e[10]=$(130,80,150),e[11]=$(100,100,100),e[17]=$(180,160,40),e[18]=$(230,40,40),e})(),hi={rgb:0,height:1,intensity:2,classification:3},gi=32,_i=4,vi=-1,yi=1/0,bi=5,xi=4096,Si=128,Ci=256,wi=2,Ti=60,Ei=.1,Di=1e5,Oi=96,ki=32,Ai=16,ji=class e{ctx;device;clearPipeline;depthPipeline;resolvePipeline;clearBindLayout;depthBindLayout;resolveBindLayout;ringBuffer;cameraUniform;chunkUniform;viewportUniform;visibleSlotListBuf;visibleSlotListScratch;depthBuffer;colorBuffer;pickBuffer;viewportPixels={w:0,h:0};clearBindGroup;depthBindGroup;resolveBindGroup;slots;freeUniformSlotIdxs;chunkToUniformIdx=new Map;uniformIdxToChunkIndex=new Map;MAX_DEFERRED_CHUNKS=256;splatRadius=2;deferredChunks=[];deferredOverflowCount=0;camera;controls;sceneCenter={x:0,y:0,z:0};TIMING_LOG_INTERVAL=25;timingDecodeTotal=0;timingPackTotal=0;timingChunkCount=0;currentFrame=0;lastViewProjElements=new Float32Array(16);rafHandle=null;resizeObserver=null;disposed=!1;realChunkCount=0;needsRender=!0;frustumChangedThisFrame=!0;viewProj=new B;cameraUniformView;chunkUniformScratch;invViewProj=new B;frustumCorners=Array.from({length:8},()=>new I);cullFrustum=new rr;cullSlotBox=new Kt;colorMode=`height`;hasRGB=!1;globalMinZ=0;globalMaxZ=1;colorParamsBuffer;classLutBuffer;edlStrength;edlRadius;onFrame;chunkEvictedCallback=null;onPointPicked=null;pickEnabled=!1;pickInFlight=!1;pickDepthStaging;pickIdStaging;pickViewProjInverse=new B;constructor(e,t){this.ctx=e,this.device=e.device,this.edlStrength=t.edlStrength??600,this.edlRadius=t.edlRadius??1,this.onFrame=t.onFrame;let n=t.ringBufferCapacity??e.ringBufferCapacity;this.slots=new di(n),this.freeUniformSlotIdxs=Array.from({length:xi},(e,t)=>xi-1-t),this.ringBuffer=this.device.createBuffer({label:`lazstream/ring`,size:n,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.cameraUniform=this.device.createBuffer({label:`lazstream/camera-uniform`,size:Oi,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.chunkUniform=this.device.createBuffer({label:`lazstream/chunk-uniform`,size:xi*ki,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.viewportUniform=this.device.createBuffer({label:`lazstream/viewport-uniform`,size:Ai,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.visibleSlotListBuf=this.device.createBuffer({label:`lazstream/visible-slot-list`,size:xi*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.cameraUniformView=new Float32Array(Oi/4),this.chunkUniformScratch=new Float32Array(ki/4),this.visibleSlotListScratch=new Uint32Array(xi),this.colorParamsBuffer=this.device.createBuffer({label:`lazstream/color-params`,size:gi,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.classLutBuffer=this.device.createBuffer({label:`lazstream/class-lut`,size:mi.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.classLutBuffer,0,mi.buffer,mi.byteOffset,mi.byteLength),this.pickDepthStaging=this.device.createBuffer({label:`lazstream/pick-depth-staging`,size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.pickIdStaging=this.device.createBuffer({label:`lazstream/pick-id-staging`,size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.clearBindLayout=this.device.createBindGroupLayout({label:`lazstream/clear-bgl`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}}]}),this.depthBindLayout=this.device.createBindGroupLayout({label:`lazstream/depth-bgl`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:`storage`}},{binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:`uniform`}},{binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:`read-only-storage`}}]}),this.resolveBindLayout=this.device.createBindGroupLayout({label:`lazstream/resolve-bgl`,entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`read-only-storage`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`read-only-storage`}}]});let r=this.device.createShaderModule({code:ri,label:`clear`}),i=this.device.createShaderModule({code:ni,label:`points-depth`}),a=this.device.createShaderModule({code:ii,label:`resolve-edl`});this.clearPipeline=this.device.createComputePipeline({label:`lazstream/clear-pl`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.clearBindLayout]}),compute:{module:r,entryPoint:`main`}}),this.depthPipeline=this.device.createComputePipeline({label:`lazstream/depth-pl`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.depthBindLayout]}),compute:{module:i,entryPoint:`main`}}),this.resolvePipeline=this.device.createRenderPipeline({label:`lazstream/resolve-pl`,layout:this.device.createPipelineLayout({bindGroupLayouts:[this.resolveBindLayout]}),vertex:{module:a,entryPoint:`vs_main`},fragment:{module:a,entryPoint:`fs_main`,targets:[{format:e.canvasFormat}]},primitive:{topology:`triangle-list`}}),this.camera=new Xn(Ti,1,Ei,Di),this.camera.position.set(0,0,1e3),this.camera.up.set(0,0,1),this.controls=new Ur(this.camera,e.canvas),this.controls.enableDamping=!0,this.controls.dampingFactor=.08,this.controls.addEventListener(`change`,()=>{this.needsRender=!0;let e=this.camera.position.distanceTo(this.controls.target);this.camera.near=Math.max(e*.001,.01),this.camera.far=Math.max(e*10,1e3),this.camera.updateProjectionMatrix()}),this.handleResize(e.canvas.clientWidth,e.canvas.clientHeight),this.resizeObserver=new ResizeObserver(e=>{for(let t of e){let e=t.contentRect;this.handleResize(e.width,e.height)}}),this.resizeObserver.observe(e.canvas),e.canvas.addEventListener(`pointerdown`,this.handleCanvasClick),this.writeViewportUniform(),this.writeColorParams(),this.rafHandle=requestAnimationFrame(this.renderFrame)}static async create(t,n={}){return new e(await li(t,{targetCapacityBytes:n.ringBufferCapacity}),n)}loadSeedPoints(e,t){if(this.disposed)return;this.needsRender=!0;let n=pi(e);if(n.pointCount===0)return;if(t){let e=t.pointDataRecordFormat;this.hasRGB=e===2||e===3||e===5||e===7||e===8||e===10,this.globalMinZ=t.minZ,this.globalMaxZ=t.maxZ,this.colorMode=this.hasRGB?`rgb`:`height`,this.writeColorParams(),console.debug(`[color] available modes: ${this.getAvailableColorModes().join(`, `)}  default=${this.colorMode}`)}let r=t?{min:[t.minX,t.minY,t.minZ],max:[t.maxX,t.maxY,t.maxZ],range:[t.maxX-t.minX,t.maxY-t.minY,t.maxZ-t.minZ]}:{min:n.min,max:[n.min[0]+n.range[0],n.min[1]+n.range[1],n.min[2]+n.range[2]],range:n.range};this.sceneCenter.x=r.min[0]+r.range[0]/2,this.sceneCenter.y=r.min[1]+r.range[1]/2,this.sceneCenter.z=1,this.addPackedData(vi,n.packed,n.pointCount,n.min,n.range)}addDecodedChunk(e){if(this.disposed)return;this.needsRender=!0;let t=performance.now(),n=fi(e),r=performance.now()-t;if(this.timingDecodeTotal+=e.decodeMs,this.timingPackTotal+=r,this.timingChunkCount++,this.timingChunkCount%this.TIMING_LOG_INTERVAL===0){let e=this.TIMING_LOG_INTERVAL;console.debug(`[lazstream/timing] last ${e} chunks — decode avg ${(this.timingDecodeTotal/e).toFixed(1)} ms  pack avg ${(this.timingPackTotal/e).toFixed(2)} ms`),this.timingDecodeTotal=0,this.timingPackTotal=0}let i=[e.minX,e.minY,e.minZ],a=[e.maxX-e.minX||1,e.maxY-e.minY||1,e.maxZ-e.minZ||1];if(this.addPackedData(e.chunkIndex,n,e.pointCount,i,a)){this.realChunkCount++,this.realChunkCount===yi&&this.releaseSlot(vi);return}if(this.deferredChunks.length>=this.MAX_DEFERRED_CHUNKS){let e=this.deferredChunks.shift();this.deferredOverflowCount++,this.chunkEvictedCallback?.(e.chunkIndex),this.deferredOverflowCount%25==1&&console.warn(`[webgpu] deferred queue overflow: ${this.deferredOverflowCount} chunks dropped (will re-fetch when camera revisits)`)}this.deferredChunks.push({chunkIndex:e.chunkIndex,packed:n,pointCount:e.pointCount,min:i,range:a})}flushDeferredChunks(){for(;this.deferredChunks.length>0;){let e=this.deferredChunks[0];if(!this.addPackedData(e.chunkIndex,e.packed,e.pointCount,e.min,e.range))break;this.deferredChunks.shift(),this.realChunkCount++,this.realChunkCount===yi&&this.releaseSlot(vi)}}getDeferredCount(){return this.deferredChunks.length}getCameraWorldPosition(){return{x:this.camera.position.x+this.sceneCenter.x,y:this.camera.position.y+this.sceneCenter.y,z:this.camera.position.z+this.sceneCenter.z}}getSceneCenter(){return{...this.sceneCenter}}getRingBufferStatus(){return{slotsFree:this.slots.getAvailableCount(this.currentFrame),slotsTotal:Math.floor(this.slots.capacity/this.slots.avgChunkBytes())}}reset(){if(!this.disposed){this.slots.clear(),this.chunkToUniformIdx.clear(),this.freeUniformSlotIdxs.length=0;for(let e=0;e<xi;e++)this.freeUniformSlotIdxs.push(xi-1-e);this.uniformIdxToChunkIndex.clear(),this.sceneCenter.x=0,this.sceneCenter.y=0,this.sceneCenter.z=0,this.realChunkCount=0,this.deferredChunks=[],this.deferredOverflowCount=0,this.timingDecodeTotal=0,this.timingPackTotal=0,this.timingChunkCount=0}}requestRender(){this.needsRender=!0}fitCameraToHeader(e){let t=e.minX-this.sceneCenter.x,n=e.maxX-this.sceneCenter.x,r=e.minY-this.sceneCenter.y,i=e.maxY-this.sceneCenter.y,a=e.minZ-this.sceneCenter.z,o=e.maxZ-this.sceneCenter.z,s=new I((t+n)/2,(r+i)/2,(a+o)/2),c=n-t,l=i-r,u=o-a,d=Math.max(Math.sqrt(c*c+l*l+u*u),1),f=this.camera.fov*(Math.PI/180),p=Math.max(d/2/Math.tan(f/2)*1.1,1),m=(u>Math.max(c,l)*.5?25:35)*(Math.PI/180),h=Math.PI/4,g=new I(p*Math.cos(m)*Math.cos(h),p*Math.cos(m)*Math.sin(h),p*Math.sin(m));this.camera.position.copy(s).add(g),this.controls.target.copy(s),this.camera.near=Math.max(p*.001,.01),this.camera.far=Math.max(p*10,1e3),this.camera.updateProjectionMatrix(),this.controls.update(),this.needsRender=!0}getFovY(){return this.camera.fov*(Math.PI/180)}getCanvasHeight(){return this.viewportPixels.h}setSplatRadius(e){this.splatRadius=Math.max(1,Math.round(e))}setColorMode(e){let t=e===`rgb`&&!this.hasRGB?`height`:e;return this.colorMode===t?t:(this.colorMode=t,this.writeColorParams(),this.needsRender=!0,console.debug(t===e?`[color] mode=${t}`:`[color] mode=${t} (requested ${e}→resolved)`),t)}get currentColorMode(){return this.colorMode}getAvailableColorModes(){let e=[`height`,`intensity`,`classification`];return this.hasRGB&&e.unshift(`rgb`),e}writeColorParams(){let e=new ArrayBuffer(gi),t=new DataView(e);t.setUint32(0,hi[this.colorMode],!0),t.setUint32(4,0,!0),t.setFloat32(8,this.globalMinZ,!0),t.setFloat32(12,this.globalMaxZ,!0),t.setFloat32(16,0,!0),t.setFloat32(20,1,!0),t.setFloat32(24,0,!0),t.setFloat32(28,0,!0),this.device.queue.writeBuffer(this.colorParamsBuffer,0,e)}setPickingEnabled(e){if(this.pickEnabled===e)return;this.pickEnabled=e,this.pickBuffer.destroy();let{w:t,h:n}=this.viewportPixels,r=e?Math.max(_i,t*n*4):_i;this.pickBuffer=this.device.createBuffer({label:`lazstream/pick`,size:r,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.rebuildBindGroups(),this.needsRender=!0}handleCanvasClick=async e=>{if(this.pickInFlight||this.disposed||!this.onPointPicked)return;this.pickInFlight=!0;let t=!1,n=!1;try{let r=this.ctx.canvas.getBoundingClientRect();console.debug(`[picking] pointerdown`,{clientX:e.clientX,clientY:e.clientY,rect:r});let i=Math.min(window.devicePixelRatio||1,wi),a=e.clientX-r.left,o=e.clientY-r.top,s=Math.floor(a*i),c=Math.floor(o*i),{w:l,h:u}=this.viewportPixels;if(s<0||s>=l||c<0||c>=u){this.onPointPicked(null);return}this.pickViewProjInverse.copy(this.viewProj).invert();let d=this.sceneCenter.x,f=this.sceneCenter.y,p=this.sceneCenter.z,m=l,h=u,g=c*l+s,_=this.device.createCommandEncoder({label:`pick`});_.copyBufferToBuffer(this.depthBuffer,g*4,this.pickDepthStaging,0,4),this.pickEnabled&&_.copyBufferToBuffer(this.pickBuffer,g*4,this.pickIdStaging,0,4),this.device.queue.submit([_.finish()]);let v=[this.pickDepthStaging.mapAsync(GPUMapMode.READ)];if(this.pickEnabled&&v.push(this.pickIdStaging.mapAsync(GPUMapMode.READ)),await Promise.all(v),this.disposed)return;t=!0,this.pickEnabled&&(n=!0);let y=new Uint32Array(this.pickDepthStaging.getMappedRange())[0];if(console.debug(`[picking] depthU32=0x`+y.toString(16).padStart(8,`0`),y===4294967295?`(miss — background)`:`(hit)`),y===4294967295){this.onPointPicked(null);return}let b=new Float32Array(new Uint32Array([y]).buffer)[0],x=new Ht(s/m*2-1,-(c/h)*2+1,b*2-1,1).applyMatrix4(this.pickViewProjInverse);x.divideScalar(x.w);let S={x:x.x+d,y:x.y+f,z:x.z+p},C=-1,w=-1;if(this.pickEnabled&&n){let e=new Uint32Array(this.pickIdStaging.getMappedRange())[0];if(e!==4294967295){let t=e>>>19;w=e&524287,C=this.uniformIdxToChunkIndex.get(t)??-1}}this.onPointPicked({worldPos:S,screenPos:{x:a,y:o},chunkIndex:C,localPointIndex:w})}catch(e){console.error(`[picking] error during pick readback:`,e)}finally{try{t&&this.pickDepthStaging.unmap()}catch{}try{n&&this.pickIdStaging.unmap()}catch{}this.pickInFlight=!1}};getFrustumWorldBBox3D(){this.invViewProj.copy(this.viewProj).invert(),this.frustumCorners[0].set(-1,-1,-1),this.frustumCorners[1].set(1,-1,-1),this.frustumCorners[2].set(-1,1,-1),this.frustumCorners[3].set(1,1,-1),this.frustumCorners[4].set(-1,-1,1),this.frustumCorners[5].set(1,-1,1),this.frustumCorners[6].set(-1,1,1),this.frustumCorners[7].set(1,1,1);let e=1/0,t=1/0,n=1/0,r=-1/0,i=-1/0,a=-1/0;for(let o=0;o<8;o++){let s=this.frustumCorners[o];s.applyMatrix4(this.invViewProj);let c=s.x+this.sceneCenter.x,l=s.y+this.sceneCenter.y,u=s.z+this.sceneCenter.z;c<e&&(e=c),l<t&&(t=l),u<n&&(n=u),c>r&&(r=c),l>i&&(i=l),u>a&&(a=u)}return{minX:e,minY:t,minZ:n,maxX:r,maxY:i,maxZ:a}}getCameraState(){return{x:this.camera.position.x+this.sceneCenter.x,y:this.camera.position.y+this.sceneCenter.y,z:this.camera.position.z+this.sceneCenter.z,tx:this.controls.target.x+this.sceneCenter.x,ty:this.controls.target.y+this.sceneCenter.y,tz:this.controls.target.z+this.sceneCenter.z,fovY:this.camera.fov*(Math.PI/180)}}applyCameraState(e){this.camera.position.set(e.x-this.sceneCenter.x,e.y-this.sceneCenter.y,e.z-this.sceneCenter.z),this.controls.target.set(e.tx-this.sceneCenter.x,e.ty-this.sceneCenter.y,e.tz-this.sceneCenter.z),this.camera.fov=e.fovY*(180/Math.PI),this.camera.updateProjectionMatrix(),this.controls.update()}dispose(){this.disposed||(this.disposed=!0,this.rafHandle!==null&&cancelAnimationFrame(this.rafHandle),this.resizeObserver?.disconnect(),this.ctx.canvas.removeEventListener(`pointerdown`,this.handleCanvasClick),this.controls.dispose(),this.ringBuffer.destroy(),this.depthBuffer.destroy(),this.colorBuffer.destroy(),this.pickBuffer.destroy(),this.pickDepthStaging.destroy(),this.pickIdStaging.destroy(),this.cameraUniform.destroy(),this.chunkUniform.destroy(),this.viewportUniform.destroy(),this.colorParamsBuffer.destroy(),this.classLutBuffer.destroy())}addPackedData(e,t,n,r,i){if(this.freeUniformSlotIdxs.length===0)return console.warn(`[webgpu] no free uniform slot for chunk ${e} — dropped`),!1;let a=n*12,o=this.slots.allocate(e,a,n,r,i,this.currentFrame);if(!o)return!1;for(let e of o.evicted){let t=this.chunkToUniformIdx.get(e.chunkIndex);t!==void 0&&(this.freeUniformSlotIdxs.push(t),this.chunkToUniformIdx.delete(e.chunkIndex)),this.chunkEvictedCallback?.(e.chunkIndex)}if(o.evicted.length>0&&console.debug(`[ring-buffer] defrag: evicted ${o.evicted.length} slot(s) to fit chunk ${e}`),!o.slot)return!1;let s=this.freeUniformSlotIdxs.pop();this.chunkToUniformIdx.set(e,s),this.uniformIdxToChunkIndex.set(s,e),this.device.queue.writeBuffer(this.ringBuffer,o.slot.byteOffset,t.buffer,t.byteOffset,t.byteLength);let c=this.chunkUniformScratch;c[0]=r[0],c[1]=r[1],c[2]=r[2],c[4]=i[0],c[5]=i[1],c[6]=i[2];let l=new DataView(c.buffer,c.byteOffset,c.byteLength);l.setUint32(12,n,!0),l.setUint32(28,o.slot.byteOffset/4,!0);for(let e=8;e<c.length;e++)c[e]=0;return this.device.queue.writeBuffer(this.chunkUniform,s*ki,c.buffer,c.byteOffset,ki),!0}releaseSlot(e){let t=this.chunkToUniformIdx.get(e);t!==void 0&&(this.freeUniformSlotIdxs.push(t),this.chunkToUniformIdx.delete(e),this.uniformIdxToChunkIndex.delete(t)),this.slots.remove(e)}setChunkEvictedCallback(e){this.chunkEvictedCallback=e}evictInvisibleSlots(){let e=this.currentFrame-bi,t=[];for(let n of this.slots.getSlots())n.chunkIndex!==vi&&(n.lastRenderedFrame>=e||!n.everRendered&&!this.frustumChangedThisFrame||t.push(n.chunkIndex));for(let e of t)this.releaseSlot(e),this.chunkEvictedCallback?.(e)}handleResize(e,t){let n=Math.min(window.devicePixelRatio||1,wi),r=Math.max(1,Math.floor(e*n)),i=Math.max(1,Math.floor(t*n));if(r===this.viewportPixels.w&&i===this.viewportPixels.h)return;this.viewportPixels={w:r,h:i},this.ctx.canvas.width=r,this.ctx.canvas.height=i,this.camera.aspect=r/i,this.camera.updateProjectionMatrix(),this.depthBuffer&&this.depthBuffer.destroy(),this.colorBuffer&&this.colorBuffer.destroy();let a=r*i*4;this.depthBuffer=this.device.createBuffer({label:`lazstream/depth`,size:a,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),this.colorBuffer=this.device.createBuffer({label:`lazstream/color`,size:a,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.pickBuffer&&this.pickBuffer.destroy(),this.pickBuffer=this.device.createBuffer({label:`lazstream/pick`,size:this.pickEnabled?a:_i,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.rebuildBindGroups(),this.writeViewportUniform(),this.needsRender=!0}rebuildBindGroups(){this.clearBindGroup=this.device.createBindGroup({label:`lazstream/clear-bg`,layout:this.clearBindLayout,entries:[{binding:0,resource:{buffer:this.depthBuffer}},{binding:1,resource:{buffer:this.pickBuffer}}]}),this.depthBindGroup=this.device.createBindGroup({label:`lazstream/depth-bg`,layout:this.depthBindLayout,entries:[{binding:0,resource:{buffer:this.cameraUniform}},{binding:1,resource:{buffer:this.chunkUniform}},{binding:2,resource:{buffer:this.ringBuffer}},{binding:3,resource:{buffer:this.depthBuffer}},{binding:4,resource:{buffer:this.colorBuffer}},{binding:5,resource:{buffer:this.visibleSlotListBuf}},{binding:6,resource:{buffer:this.pickBuffer}},{binding:7,resource:{buffer:this.colorParamsBuffer}},{binding:8,resource:{buffer:this.classLutBuffer}}]}),this.resolveBindGroup=this.device.createBindGroup({label:`lazstream/resolve-bg`,layout:this.resolveBindLayout,entries:[{binding:0,resource:{buffer:this.viewportUniform}},{binding:1,resource:{buffer:this.depthBuffer}},{binding:2,resource:{buffer:this.colorBuffer}}]})}writeViewportUniform(){let e=new ArrayBuffer(Ai),t=new DataView(e);t.setFloat32(0,this.viewportPixels.w,!0),t.setFloat32(4,this.viewportPixels.h,!0),t.setFloat32(8,this.edlStrength,!0),t.setFloat32(12,this.edlRadius,!0),this.device.queue.writeBuffer(this.viewportUniform,0,e)}writeCameraUniform(){this.camera.updateMatrixWorld(),this.viewProj.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);let e=!1,t=this.viewProj.elements;for(let n=0;n<16;n++)if(t[n]!==this.lastViewProjElements[n]){e=!0,this.lastViewProjElements.set(t);break}this.frustumChangedThisFrame=e;let n=this.cameraUniformView;n.set(this.viewProj.elements,0),n[16]=this.viewportPixels.w,n[17]=this.viewportPixels.h,n[18]=0,n[19]=0,n[20]=this.sceneCenter.x,n[21]=this.sceneCenter.y,n[22]=this.sceneCenter.z,n[23]=this.splatRadius,this.device.queue.writeBuffer(this.cameraUniform,0,n.buffer,n.byteOffset,n.byteLength)}renderFrame=()=>{if(this.disposed||(this.rafHandle=requestAnimationFrame(this.renderFrame),this.currentFrame++,this.controls.update(),!this.needsRender&&this.deferredChunks.length===0))return;this.needsRender=!1,this.writeCameraUniform();let e=this.device.createCommandEncoder({label:`lazstream/frame-${this.currentFrame}`});{let t=e.beginComputePass({label:`clear-depth`});t.setPipeline(this.clearPipeline),t.setBindGroup(0,this.clearBindGroup);let n=this.viewportPixels.w*this.viewportPixels.h;t.dispatchWorkgroups(Math.ceil(n/Ci)),t.end()}{let t=e.beginComputePass({label:`points-depth`});t.setPipeline(this.depthPipeline),this.cullFrustum.setFromProjectionMatrix(this.viewProj);let n=this.sceneCenter.x,r=this.sceneCenter.y,i=this.sceneCenter.z,a=0,o=0;for(let e of this.slots.getSlots()){if(e.pointCount===0||(this.cullSlotBox.min.set(e.min[0]-n,e.min[1]-r,e.min[2]-i),this.cullSlotBox.max.set(e.min[0]-n+e.range[0],e.min[1]-r+e.range[1],e.min[2]-i+e.range[2]),!this.cullFrustum.intersectsBox(this.cullSlotBox)))continue;let t=this.chunkToUniformIdx.get(e.chunkIndex);t!==void 0&&(this.visibleSlotListScratch[a++]=t,e.pointCount>o&&(o=e.pointCount),this.slots.touch(e.chunkIndex,this.currentFrame))}if(a>0){this.device.queue.writeBuffer(this.visibleSlotListBuf,0,this.visibleSlotListScratch.buffer,0,a*4);let e=Math.ceil(o/Si);t.setBindGroup(0,this.depthBindGroup),t.dispatchWorkgroups(e,a,1)}t.end()}this.evictInvisibleSlots(),this.flushDeferredChunks();{let t=this.ctx.context.getCurrentTexture().createView(),n=e.beginRenderPass({label:`resolve`,colorAttachments:[{view:t,loadOp:`clear`,storeOp:`store`,clearValue:{r:.04,g:.04,b:.06,a:1}}]});n.setPipeline(this.resolvePipeline),n.setBindGroup(0,this.resolveBindGroup),n.draw(3),n.end()}this.device.queue.submit([e.finish()]),this.onFrame&&this.onFrame({frame:this.currentFrame,slots:this.slots.getSlots().length,pointsLoaded:this.slots.pointsLoaded()})}},Mi=`/assets/decode-worker-Moc5SB21.js`,Ni=`modulepreload`,Pi=function(e){return`/`+e},Fi={},Ii=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}r=o(t.map(t=>{if(t=Pi(t,n),t in Fi)return;Fi[t]=!0;let r=t.endsWith(`.css`),i=r?`[rel="stylesheet"]`:``;if(n)for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}else if(document.querySelector(`link[href="${t}"]${i}`))return;let o=document.createElement(`link`);if(o.rel=r?`stylesheet`:Ni,r||(o.as=`script`),o.crossOrigin=``,o.href=t,a&&o.setAttribute(`nonce`,a),document.head.appendChild(o),r)return new Promise((e,n)=>{o.addEventListener(`load`,e),o.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},Li=``,Ri=document.getElementById(`canvas`),zi=document.getElementById(`url-input`),Bi=document.getElementById(`load-btn`),Vi=document.getElementById(`share-btn`),Hi=document.getElementById(`status`),Ui=document.getElementById(`stats`),Wi=document.getElementById(`progress`),Gi=document.getElementById(`warning`),Ki=document.getElementById(`attribution`);async function qi(){let e=new URLSearchParams(location.search),t=e.get(`bufferMB`),n=t!==null&&Number.isFinite(parseFloat(t))?Math.floor(parseFloat(t)*1024*1024):void 0,r=e.get(`sseMin`),i=r!==null&&Number.isFinite(parseFloat(r))?parseFloat(r):void 0,a=e.get(`workerCount`),o=a!==null&&Number.isFinite(parseInt(a,10))?Math.max(1,parseInt(a,10)):void 0,s=e.get(`maxFetches`),c=s!==null&&Number.isFinite(parseInt(s,10))?Math.max(1,parseInt(s,10)):void 0,d=e.get(`splatRadius`),p=d!==null&&Number.isFinite(parseInt(d,10))?Math.max(1,parseInt(d,10)):void 0,m=null;if(e.has(`timing`)){let{installFetchTimingObserver:e}=await Ii(async()=>{let{installFetchTimingObserver:e}=await import(`./fetch-timing-hz8S2mq6.js`);return{installFetchTimingObserver:e}},[]);e({origin:`https://data.lazstream.stream`,onChunkDecoded:e=>{m=e}})}let h=null,g=null,_=null,v=window.location.hash.slice(1).match(/(?:^|&)v=([^&]+)/);if(v)try{let e=Ae(v[1]);_=e.source,h=e.cam,e.colorMode&&(g=e.colorMode)}catch{console.warn(`[lazstream] Invalid #v= token — ignoring`)}if(!g){let t=e.get(`colorMode`);t&&(g=t)}function y(e){let t=e instanceof Error?e:Error(String(e));console.error(`[lazstream]`,t),t instanceof f?(Hi.textContent=`CORS error — file could not be loaded`,Hi.className=`status status--error`,Gi.textContent=`⚠ CORS headers missing on the hosting server. Required: Access-Control-Allow-Origin · Access-Control-Allow-Headers: Range · Access-Control-Expose-Headers: Content-Range, Content-Length`,Gi.style.display=`block`):(Hi.textContent=`Error: ${t.message}`,Hi.className=`status status--error`)}let b=null;function x(){if(!b)return;let e=ke({source:b,cam:C.getCameraState(),colorMode:C.currentColorMode});history.replaceState(null,``,`#v=`+e)}function S(e){C.setColorMode(e),x()}let C;try{C=await ji.create(Ri,{ringBufferCapacity:n,onFrame({slots:e,pointsLoaded:t}){Ui.textContent=`${e} chunks · ${t.toLocaleString()} pts`,w?.updateCamera()}})}catch(e){if(e instanceof ai){Hi.textContent=`WebGPU is not supported in this browser. Try Chrome 120+ or Edge 120+.`,Hi.className=`status status--error`,Bi.disabled=!0;return}throw e}p!==void 0&&C.setSplatRadius(p),C.onPointPicked=async e=>{if(console.log(`[pick]`,e),e&&e.chunkIndex>=0&&e.localPointIndex>=0&&w){let t=await w.resolvePointAttributes(e.chunkIndex,e.localPointIndex);console.log(`[pick:attrs]`,t)}},C.setPickingEnabled(!0),Vi.addEventListener(`click`,()=>{b&&(x(),navigator.clipboard.writeText(window.location.href).then(()=>{Vi.textContent=`Copied!`,setTimeout(()=>{Vi.textContent=`Share`},2e3)}).catch(()=>{}))}),document.addEventListener(`keydown`,e=>{if(e.target.tagName===`INPUT`)return;let t={1:`rgb`,2:`height`,3:`intensity`,4:`classification`}[e.key];t&&S(t)});let w=null;function T(e){w&&=(w.dispose(),null);let t=new ye(e,{events:{onStateChange(e,t){Hi.textContent=t,Hi.className=`status status--${e}`,Bi.disabled=e!==`idle`&&e!==`ready`&&e!==`error`,(e===`ready`||e===`error`)&&(Wi.style.display=`none`),e===`streaming`&&C.requestRender()},onWarning(e){Gi.textContent=`⚠ ${e}`,Gi.style.display=`block`},onProgress(e,t,n){let r=Math.round(e/t*100);Wi.style.display=`block`,Wi.style.setProperty(`--progress`,`${r}%`),Wi.title=`${n}: ${e} / ${t}`},onStats(e){let t=(e.fileSize/1024/1024).toFixed(1),n=e.pointCount.toLocaleString(),r=e.decodedChunks??0,i=e.chunkCount,a=`${e.version} · PDRF ${e.format} · ${n} pts · ${t} MB`;if(r>0){let t=(e.decodedPoints??0).toLocaleString();a+=` · ${r}/${i} chunks · ${t} decoded`}(e.activeWorkers??0)>0&&(a+=` · ${e.activeWorkers} workers active`),Ui.textContent=a},onSeedsReady(e,t){C.loadSeedPoints(e,t),g&&=(C.setColorMode(g),null),h?(C.applyCameraState(h),h=null):C.fitCameraToHeader(t),Vi.disabled=!1},onChunkDecoded(e){C.addDecodedChunk(e),m?.(e)},onError(e){y(e)}},workerCount:o,sseThreshold:i,maxFetches:c,assetUrls:{workerUrl:Mi,lazPerfJsUrl:new URL(`/lib/laz-perf-worker.js`,location.href).href,lazPerfWasmUrl:new URL(`/lib/laz-perf-worker.wasm`,location.href).href}});return t.setCameraProvider(()=>{let e=C.getCameraWorldPosition();return{worldX:e.x,worldY:e.y,worldZ:e.z,fovY:C.getFovY(),canvasHeight:C.getCanvasHeight()}}),t.setFrustumProvider(()=>C.getFrustumWorldBBox3D()),t.setRingBufferProvider(()=>C.getRingBufferStatus()),C.setChunkEvictedCallback(e=>t.onChunkEvictedFromGPU(e)),w=t,t}async function E(e,t){b=e,Vi.disabled=!0,Gi.style.display=`none`,Wi.style.display=`none`,Ki.style.display=`none`,C.reset();let n=t===`manifest`||e.trim().toLowerCase().endsWith(`.lazm.json`),r;try{n?(t!==`manifest`&&l(e),r=await Se(e)):r=we(e)}catch(e){y(e);return}r.attribution&&(Ki.textContent=r.attribution,Ki.style.display=`block`),await T(r).load()}if(Bi.addEventListener(`click`,()=>{E(zi.value.trim()||Li)}),zi.addEventListener(`keydown`,e=>{e.key===`Enter`&&Bi.click()}),_){zi.value=_;let e=_.toLowerCase().endsWith(`.lazm.json`)?`manifest`:`laz`;E(_,e)}else{let e=u();zi.value=e?.url??Li,e&&E(e.url,e.type)}}qi();