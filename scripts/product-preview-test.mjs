import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhotonImage } from '@cf-wasm/photon';
import { imageSize } from '../worker/image-size.js';
import { productPreview, productPreviewGet, previewJpeg, PREVIEW_MAX_BYTES } from '../worker/product-preview.js';
import worker from '../worker/index.js';
import { productGet } from '../worker/routes/shop.js';

const id='bbbbbbbb-1111-4111-8111-111111111111';
const key=`products/aaaaaaaa-1111-4111-8111-111111111111/${id}/real-full.webp`;
const shop={id:'aaaaaaaa-1111-4111-8111-111111111111',slug:'real-shop',name:'دوکان',whatsapp:'+9647500000000'};
let image=new PhotonImage(new Uint8Array([255,0,0,255,0,0,255,255]),2,1);
const fixtures={png:image.get_bytes(),jpeg:image.get_bytes_jpeg(90),webp:image.get_bytes_webp()};image.free();
const product={id,title:'جلوبەرگ',price:25000,currency:'IQD',images:[{full:key,card:key.replace('full','card')}],shop};
const row={...product,shops:shop,product_images:[{r2_key:product.images[0].card,r2_key_full:key,position:0}]};

test('PNG, JPEG and WebP become bounded, valid 600-square JPEGs of the real pixels',()=>{
  for(const [format,bytes] of Object.entries(fixtures)){
    assert.deepEqual(imageSize(bytes),{width:2,height:1},format);
    const jpeg=previewJpeg(bytes);
    assert.equal(jpeg[0],255);assert.equal(jpeg[1],216);
    assert.ok(jpeg.length<=PREVIEW_MAX_BYTES);
    assert.deepEqual(imageSize(jpeg),{width:600,height:600});
    const decoded=PhotonImage.new_from_byteslice(jpeg);
    try {
      const pixels=decoded.get_raw_pixels();
      assert.ok(pixels[0]>240 && pixels[1]>240 && pixels[2]>240,'white padding, no substituted photo');
      const red=(299*600+299)*4,blue=(299*600+300)*4;
      assert.ok(pixels[red]>pixels[red+2] && pixels[blue+2]>pixels[blue],'original red and blue retained without cropping');
    } finally {decoded.free();}
  }
});

test('allocation guards reject corrupt, huge, zero and oversized sources before decode',()=>{
  for(const bytes of [new Uint8Array(),new Uint8Array([255,216,255,192,0]),new Uint8Array(4*1024*1024+1)])
    assert.throws(()=>previewJpeg(bytes));
  for(const [w,h] of [[0,1],[5000,100],[3000,2000]]){
    const bytes=fixtures.png.slice(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    view.setUint32(16,w);view.setUint32(20,h);assert.throws(()=>previewJpeg(bytes));
  }
  const extended=new Uint8Array(fixtures.webp.length+18);
  extended.set(fixtures.webp.subarray(0,12));
  extended.set(new TextEncoder().encode('VP8X'),12);extended[16]=10;
  extended.set(fixtures.webp.subarray(12),30);
  new DataView(extended.buffer).setUint32(4,extended.length-8,true);
  assert.equal(imageSize(extended),null,'small VP8X canvas cannot conceal a larger frame');
  extended[24]=1; // Matches the real 2x1 compressed frame.
  assert.deepEqual(imageSize(extended),{width:2,height:1});
  extended[20]=2;assert.equal(imageSize(extended),null,'animated WebP is bounded out before decoding');
  assert.ok(previewJpeg(fixtures.png).length>0,'a rejected source does not break later previews');
});

test('stable image-specific URL changes when the cover changes, not when price changes',async()=>{
  const a=await productPreview(product);
  assert.match(a.url,/^https:\/\/bazarnow\.xyz\/preview\/products\/[a-f0-9-]+\/[a-f0-9]{32}\.jpg$/);
  assert.equal((await productPreview({...product,price:9000})).url,a.url);
  assert.notEqual((await productPreview({...product,images:[{full:key+'-new'}]})).url,a.url);
  assert.equal(await productPreview({...product,images:[]}),null);
  assert.equal((await productPreview({...product,images:[{card:key}]})).key,key);
});

test('real Worker route serves JPEG, HEAD/304; checks RLS and current cover before cached bytes',async()=>{
  const original=globalThis.fetch,reads=[],pending=[],cacheData=new Map();
  let eligible=true,current=row,r2reads=0;
  const cache={match:async key=>cacheData.get(key.url)?.clone(),put:async(key,value)=>cacheData.set(key.url,value)};
  const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',IMAGES:{
    get:async actual=>{assert.equal(actual,key);r2reads++;return {size:fixtures.png.length,arrayBuffer:async()=>fixtures.png.buffer.slice(fixtures.png.byteOffset,fixtures.png.byteOffset+fixtures.png.byteLength)};},
    put:()=>assert.fail('No image writes permitted'),delete:()=>assert.fail('No image deletion permitted'),
  }};
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input);reads.push(url);
    assert.equal(url.origin,'https://synthetic.invalid');assert.equal(init.headers.authorization,'Bearer synthetic-public');
    assert.ok(!init.method || init.method==='GET');
    if(url.pathname.endsWith('/rpc/shop_public_profile'))return Response.json([shop]);
    return Response.json(eligible && !url.searchParams.get('id')?.startsWith('neq.')?[current]:[]);
  };
  const preview=await productPreview(product),ctx={waitUntil:p=>pending.push(p)};
  const get=(method='GET',headers={})=>productPreviewGet(new Request(preview.url,{method,headers}),env,id,preview.version,ctx,cache);
  try{
    const response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');
    const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(Number(response.headers.get('content-length')),bytes.length);
    assert.deepEqual(imageSize(bytes),{width:600,height:600});assert.equal(response.headers.get('cache-control'),'public, max-age=0, must-revalidate');
    await Promise.all(pending);assert.equal(cacheData.size,1);
    const head=await get('HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(r2reads,1);
    assert.equal((await get('GET',{'if-none-match':head.headers.get('etag')})).status,304);
    eligible=false;
    assert.equal((await get()).status,404);assert.equal((await get('GET',{'if-none-match':head.headers.get('etag')})).status,404);
    eligible=true;current={...row,product_images:[{r2_key:key+'-replacement',position:0}]};
    assert.equal((await get()).status,404,'old-cover URL cannot return cached bytes');
    current=row;
    assert.equal((await get('POST')).status,405);
    const hardened=await worker.fetch(new Request(preview.url),env,{});
    assert.equal(hardened.status,200);assert.equal(hardened.headers.get('x-content-type-options'),'nosniff');
    assert.ok(reads.length>=6);
  }finally{globalThis.fetch=original;}
});

test('missing uploaded source returns 404 without seed, brand or external image fallback',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json([row]);
  try{
    const preview=await productPreview(product);
    const response=await productPreviewGet(new Request(preview.url),{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_PUBLISHABLE_KEY:'public',IMAGES:{get:async()=>null}},id,preview.version);
    assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
  }finally{globalThis.fetch=original;}
});

test('product with no photo does not advertise a shop cover or placeholder',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async input=>Response.json(String(input).includes('shop_public_profile')?[{...shop,cover_key:'shops/banner.webp'}]:[{...row,product_images:[]}]);
  try{
    const url=new URL(`https://bazarnow.xyz/@${shop.slug}/p/${id}`);
    const html=await(await productGet(new Request(url),{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_PUBLISHABLE_KEY:'public'},url,shop.slug,id)).text();
    assert.ok(!html.includes('property="og:image"'));
  }finally{globalThis.fetch=original;}
});
