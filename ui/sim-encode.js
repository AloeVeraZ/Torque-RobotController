(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckEncode=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Video files from the Video workspace. Pictures are drawn one by one at the video's own frame rate (not in real
  // time), encoded with the system's WebCodecs encoders and written into a file here: MP4 (H.264, with AAC or Opus
  // sound) where the system encodes H.264, else WebM (VP9 or VP8, with Opus). Nothing is assumed: probe() asks the
  // encoders what this system supports, and only those choices are offered.
  const te=new TextEncoder();
  // ---------------------------------------------------------------- bytes
  class Bytes{
    constructor(){this.parts=[];this.size=0;}
    push(u8){this.parts.push(u8);this.size+=u8.length;return this;}
    u8(v){return this.push(Uint8Array.of(v&255));}
    u16(v){return this.push(Uint8Array.of((v>>8)&255,v&255));}
    u24(v){return this.push(Uint8Array.of((v>>16)&255,(v>>8)&255,v&255));}
    u32(v){return this.push(Uint8Array.of((v>>>24)&255,(v>>16)&255,(v>>8)&255,v&255));}
    i32(v){return this.u32(v>>>0);}
    u64(v){const hi=Math.floor(v/2**32),lo=v>>>0;return this.u32(hi).u32(lo);}
    str(s){return this.push(te.encode(s));}
    zeros(n){return this.push(new Uint8Array(n));}
    bytes(){const out=new Uint8Array(this.size);let o=0;for(const p of this.parts){out.set(p,o);o+=p.length;}return out;}
  }
  const cat=list=>{const b=new Bytes();for(const p of list)b.push(p);return b.bytes();};
  // ---------------------------------------------------------------- MP4
  function box(type,...content){const body=cat(content.map(c=>c instanceof Bytes?c.bytes():c)),b=new Bytes();b.u32(8+body.length).str(type).push(body);return b.bytes();}
  const full=(type,version,flags,...content)=>{const h=new Bytes().u8(version).u24(flags);return box(type,h,...content);};
  const MATRIX=()=>{const b=new Bytes();for(const v of [0x10000,0,0,0,0x10000,0,0,0,0x40000000])b.u32(v);return b;};
  // Descriptor with a 4-byte length, as MP4 esds boxes write them.
  const desc=(tag,body)=>{const b=new Bytes().u8(tag);const n=body.length;b.push(Uint8Array.of(0x80|((n>>21)&127),0x80|((n>>14)&127),0x80|((n>>7)&127),n&127)).push(body);return b.bytes();};
  // OpusHead (little-endian, as the encoder describes it) to MP4's dOps (big-endian).
  function dOps(head,channels,rate){const dv=head&&head.length>=19?new DataView(head.buffer,head.byteOffset,head.byteLength):null,pre=dv?dv.getUint16(10,true):312,input=dv?dv.getUint32(12,true):rate,gain=dv?dv.getInt16(16,true):0;
    return box('dOps',new Bytes().u8(0).u8(channels).u16(pre).u32(input).u16(gain&0xffff).u8(0));}
  // An MP4 writer: add encoded pictures and sound, then finish() returns the file with the index first (so it starts
  // playing straight away). Times are microseconds, as WebCodecs gives them.
  function mp4({video,audio}){
    const v={samples:[],t0:null},a={samples:[]};
    return {
      addVideo(chunk){if(v.t0===null)v.t0=chunk.timestamp;v.samples.push({data:chunk.data,key:chunk.type==='key',pts:chunk.timestamp-v.t0,duration:chunk.duration});},
      addAudio(chunk){a.samples.push({data:chunk.data,pts:chunk.timestamp,duration:chunk.duration});},
      finish(){
        if(!v.samples.length)throw Error('No pictures were encoded.');
        const vt=video.timescale||90000,toV=us=>Math.round(us*vt/1e6),movie=1000;
        // Decode order is the order the encoder gave; presentation offsets only when it reordered pictures.
        const step=toV(v.samples[1]?v.samples[1].pts-v.samples[0].pts:(v.samples[0].duration||33333)),dts=v.samples.map((s,i)=>i*step),cts=v.samples.map((s,i)=>toV(s.pts)-dts[i]);
        const vDur=dts.at(-1)+step,aRate=audio?.sampleRate||48000,aDur=a.samples.reduce((s,x)=>s+Math.round((x.duration||0)*aRate/1e6),0);
        const movieDur=Math.max(Math.round(vDur*movie/vt),audio&&a.samples.length?Math.round(aDur*movie/aRate):0);
        const build=(vOff,aOff)=>{
          const stts=(durs)=>{const runs=[];for(const d of durs){const r=runs.at(-1);if(r&&r[1]===d)r[0]++;else runs.push([1,d]);}const b=new Bytes().u32(runs.length);for(const [n,d] of runs)b.u32(n).u32(d);return full('stts',0,0,b);};
          const stsz=list=>{const b=new Bytes().u32(0).u32(list.length);for(const s of list)b.u32(s.data.length);return full('stsz',0,0,b);};
          const one=(n,off)=>[full('stsc',0,0,new Bytes().u32(1).u32(1).u32(n).u32(1)),full('stco',0,0,new Bytes().u32(1).u32(off))];
          const avc=new Bytes().zeros(6).u16(1).zeros(16).u16(video.width).u16(video.height).u32(0x480000).u32(0x480000).u32(0).u16(1).zeros(32).u16(0x18).u16(0xffff);
          const vEntry=video.codec==='avc'?box('avc1',avc,box('avcC',video.description)):null;if(!vEntry)throw Error('MP4 here holds H.264 only.');
          const keys=v.samples.map((s,i)=>s.key?i+1:0).filter(Boolean),stss=new Bytes().u32(keys.length);for(const k of keys)stss.u32(k);
          const reordered=cts.some(c=>c!==0),ctts=reordered?(()=>{const b=new Bytes().u32(cts.length);for(const c of cts)b.u32(1).i32(c);return full('ctts',1,0,b);})():new Uint8Array();
          const vstbl=box('stbl',full('stsd',0,0,new Bytes().u32(1),vEntry),stts(v.samples.map(()=>step)),ctts,full('stss',0,0,stss),...one(v.samples.length,vOff),stsz(v.samples));
          const tkhd=(id,dur,vol,w,h)=>full('tkhd',0,3,new Bytes().u32(0).u32(0).u32(id).u32(0).u32(dur).zeros(8).u16(0).u16(0).u16(vol).u16(0),MATRIX(),new Bytes().u32(w*65536).u32(h*65536));
          const mdhd=(scale,dur)=>full('mdhd',0,0,new Bytes().u32(0).u32(0).u32(scale).u32(dur).u16(0x55c4).u16(0));
          const hdlr=(t,name)=>full('hdlr',0,0,new Bytes().u32(0).str(t).zeros(12).str(name+'\0'));
          const dinf=box('dinf',full('dref',0,0,new Bytes().u32(1),full('url ',0,1)));
          const vtrak=box('trak',tkhd(1,Math.round(vDur*movie/vt),0,video.width,video.height),box('mdia',mdhd(vt,vDur),hdlr('vide','Deck video'),box('minf',full('vmhd',0,1,new Bytes().zeros(8)),dinf,vstbl)));
          let atrak=new Uint8Array();
          if(audio&&a.samples.length){
            const ch=audio.channels||2,entry=new Bytes().zeros(6).u16(1).zeros(8).u16(ch).u16(16).u16(0).u16(0).u32(aRate*65536);
            const sample=audio.codec==='aac'?box('mp4a',entry,full('esds',0,0,desc(3,cat([new Bytes().u16(2).u8(0).bytes(),desc(4,cat([new Bytes().u8(0x40).u8(0x15).u24(0).u32(audio.bitrate||192000).u32(audio.bitrate||192000).bytes(),desc(5,audio.description||new Uint8Array())])),desc(6,Uint8Array.of(2))]))))
              :box('Opus',entry,dOps(audio.description,ch,aRate));
            const astbl=box('stbl',full('stsd',0,0,new Bytes().u32(1),sample),stts(a.samples.map(s=>Math.round((s.duration||0)*aRate/1e6))),...one(a.samples.length,aOff),stsz(a.samples));
            atrak=box('trak',tkhd(2,Math.round(aDur*movie/aRate),0x100,0,0),box('mdia',mdhd(aRate,aDur),hdlr('soun','Deck sound'),box('minf',full('smhd',0,0,new Bytes().u32(0)),dinf,astbl)));}
          const mvhd=full('mvhd',0,0,new Bytes().u32(0).u32(0).u32(movie).u32(movieDur).u32(0x10000).u16(0x100).zeros(10),MATRIX(),new Bytes().zeros(24).u32(3));
          return box('moov',mvhd,vtrak,atrak);};
        const ftyp=box('ftyp',new Bytes().str('isom').u32(512).str('isomiso2avc1mp41'));
        const vBytes=v.samples.reduce((s,x)=>s+x.data.length,0),aBytes=a.samples.reduce((s,x)=>s+x.data.length,0);
        // The index's size does not depend on the offsets in it, so build it once to measure and again with them.
        const moovSize=build(0,0).length,mdatStart=ftyp.length+moovSize+8,moov=build(mdatStart,mdatStart+vBytes);
        const mdat=new Bytes().u32(8+vBytes+aBytes).str('mdat');for(const s of v.samples)mdat.push(s.data);for(const s of a.samples)mdat.push(s.data);
        return cat([ftyp,moov,mdat.bytes()]);
      }};
  }
  // ---------------------------------------------------------------- WebM
  const ID={EBML:[0x1a,0x45,0xdf,0xa3],Segment:[0x18,0x53,0x80,0x67],SeekHead:[0x11,0x4d,0x9b,0x74],Seek:[0x4d,0xbb],SeekID:[0x53,0xab],SeekPosition:[0x53,0xac],Info:[0x15,0x49,0xa9,0x66],Tracks:[0x16,0x54,0xae,0x6b],Cues:[0x1c,0x53,0xbb,0x6b],Cluster:[0x1f,0x43,0xb6,0x75]};
  const vsize=n=>{const b=new Uint8Array(8);b[0]=1;let v=n;for(let i=7;i>0;i--){b[i]=v%256;v=Math.floor(v/256);}return b;};
  const el=(id,...content)=>{const body=cat(content.map(c=>typeof c==='string'?te.encode(c):c));return cat([Uint8Array.from(id),vsize(body.length),body]);};
  const uint=(id,v,width)=>{let n=width||1;if(!width)while(n<8&&v>=2**(8*n))n++;const b=new Uint8Array(n);let x=v;for(let i=n-1;i>=0;i--){b[i]=x%256;x=Math.floor(x/256);}return el(id,b);};
  const float=(id,v)=>{const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,v);return el(id,b);};
  function webm({video,audio}){
    const blocks=[];let v0=null;
    return {
      addVideo(chunk){if(v0===null)v0=chunk.timestamp;blocks.push({track:1,key:chunk.type==='key',ms:Math.round((chunk.timestamp-v0)/1000),data:chunk.data});},
      addAudio(chunk){blocks.push({track:2,key:true,ms:Math.round(chunk.timestamp/1000),data:chunk.data,audio:true});},
      finish(){
        if(!blocks.some(b=>b.track===1))throw Error('No pictures were encoded.');
        blocks.sort((a,b)=>a.ms-b.ms||a.track-b.track);const last=blocks.at(-1).ms+33;
        const vEntry=el([0xae],uint([0xd7],1),uint([0x73,0xc5],1),uint([0x83],1),el([0x86],video.codec==='vp9'?'V_VP9':'V_VP8'),el([0xe0],uint([0xb0],video.width),uint([0xba],video.height)));
        const aEntry=audio?el([0xae],uint([0xd7],2),uint([0x73,0xc5],2),uint([0x83],2),el([0x86],'A_OPUS'),...(audio.description?[el([0x63,0xa2],audio.description)]:[]),uint([0x56,0xaa],6500000),uint([0x56,0xbb],80000000),el([0xe1],float([0xb5],audio.sampleRate||48000),uint([0x9f],audio.channels||2))):new Uint8Array();
        const info=el(ID.Info,uint([0x2a,0xd7,0xb1],1000000),el([0x4d,0x80],'Torque'),el([0x57,0x41],'Torque'),float([0x44,0x89],last));
        const tracks=el(ID.Tracks,vEntry,aEntry);
        // Clusters start at each key picture (or every 5 s), so a player can seek to any of them.
        const clusters=[];let cur=null;
        for(const b of blocks){if(!cur||(b.track===1&&b.key&&b.ms-cur.ms>=1000)||b.ms-cur.ms>5000){cur={ms:b.ms,blocks:[],key:b.track===1&&b.key};clusters.push(cur);}cur.blocks.push(b);}
        const clusterBytes=clusters.map(c=>el(ID.Cluster,uint([0xe7],c.ms),...c.blocks.map(b=>{const rel=b.ms-c.ms,head=Uint8Array.of(0x80|b.track,(rel>>8)&255,rel&255,b.key?0x80:0);return el([0xa3],head,b.data);})));
        // Fixed-width positions keep the sizes of the cues and the seek head the same whatever they point at.
        const cues=pos=>el(ID.Cues,...clusters.map((c,i)=>c.key?el([0xbb],uint([0xb3],c.ms,8),el([0xb7],uint([0xf7],1),uint([0xf1],pos[i],8))):null).filter(Boolean));
        const seek=(o)=>el(ID.SeekHead,...[[ID.Info,o.info],[ID.Tracks,o.tracks],[ID.Cues,o.cues]].map(([id,p])=>el(ID.Seek,el(ID.SeekID,Uint8Array.from(id)),uint(ID.SeekPosition,p,8))));
        const sh=seek({info:0,tracks:0,cues:0}).length,cueLen=cues(clusters.map(()=>0)).length,start=sh+info.length+tracks.length+cueLen,pos=[];let p=start;for(const c of clusterBytes){pos.push(p);p+=c.length;}
        const body=cat([seek({info:sh,tracks:sh+info.length,cues:sh+info.length+tracks.length}),info,tracks,cues(pos),...clusterBytes]);
        const header=el(ID.EBML,uint([0x42,0x86],1),uint([0x42,0xf7],1),uint([0x42,0xf2],4),uint([0x42,0xf3],8),el([0x42,0x82],'webm'),uint([0x42,0x87],4),uint([0x42,0x85],2));
        return cat([header,Uint8Array.from(ID.Segment),vsize(body.length),body]);
      }};
  }
  // ---------------------------------------------------------------- reading files back
  // What an exported MP4 holds, from its boxes: the tracks with their codec, size, sample count and length.
  function inspectMp4(bytes){
    const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),str=(o,n=4)=>String.fromCharCode(...bytes.subarray(o,o+n));
    const walk=(start,stop,out=[])=>{for(let o=start;o+8<=stop;){const size=dv.getUint32(o),type=str(o+4);if(size<8||o+size>stop)throw Error(`Broken MP4 box ${type} at ${o}.`);out.push({type,start:o,size,body:o+8});o+=size;}return out;};
    const top=walk(0,bytes.length),find=(list,type)=>list.find(b=>b.type===type),kids=b=>walk(b.body,b.start+b.size);
    const moov=find(top,'moov'),mdat=find(top,'mdat');if(!moov||!mdat)throw Error('The MP4 has no index or no media.');
    const mvhd=find(kids(moov),'mvhd'),scale=dv.getUint32(mvhd.body+12),movieDur=dv.getUint32(mvhd.body+16);
    const tracks=kids(moov).filter(b=>b.type==='trak').map(t=>{const mdia=find(kids(t),'mdia'),md=kids(mdia),mdhd=find(md,'mdhd'),hdlr=find(md,'hdlr'),stbl=find(kids(find(md,'minf')),'stbl'),sb=kids(stbl);
      const stsd=find(sb,'stsd'),entry=walk(stsd.body+8,stsd.start+stsd.size)[0],stsz=find(sb,'stsz'),count=dv.getUint32(stsz.body+8),stco=find(sb,'stco'),offset=dv.getUint32(stco.body+8);
      let size=0;for(let i=0;i<count;i++)size+=dv.getUint32(stsz.body+12+i*4);const stss=find(sb,'stss');
      return {kind:str(hdlr.body+8),codec:entry.type,timescale:dv.getUint32(mdhd.body+12),duration:dv.getUint32(mdhd.body+16)/dv.getUint32(mdhd.body+12),samples:count,bytes:size,offset,
        keyframes:stss?dv.getUint32(stss.body+4):null,...(entry.type==='avc1'?{width:dv.getUint16(entry.body+24),height:dv.getUint16(entry.body+26)}:{})};});
    for(const t of tracks)if(t.offset<mdat.body||t.offset+t.bytes>mdat.start+mdat.size)throw Error(`Track ${t.codec} points outside its media.`);
    return {brand:str(top[0].body),duration:movieDur/scale,tracks,boxes:top.map(b=>b.type)};
  }
  // What an exported WebM holds: its codecs, picture size, length and how many blocks and key pictures.
  function inspectWebm(bytes){
    let o=0;const readId=()=>{const b=bytes[o],n=b&0x80?1:b&0x40?2:b&0x20?3:4;const id=bytes.subarray(o,o+n);o+=n;return Array.from(id).map(x=>x.toString(16).padStart(2,'0')).join('');};
    const readSize=()=>{const b=bytes[o];let n=1;while(n<=8&&!(b&(0x80>>(n-1))))n++;let v=b&(0xff>>n);for(let i=1;i<n;i++)v=v*256+bytes[o+i];o+=n;return v;};
    const out={codecs:[],width:0,height:0,blocks:0,keys:0,duration:0};
    const walk=stop=>{while(o<stop){const id=readId(),size=readSize(),body=o;
      if(['18538067','1549a966','1654ae6b','ae','e0','1f43b675','1c53bb6b'].includes(id)){if(id==='18538067')walk(Math.min(bytes.length,body+size));else walk(body+size);}
      else{if(id==='86')out.codecs.push(new TextDecoder().decode(bytes.subarray(body,body+size)));if(id==='b0')out.width=bytes.subarray(body,body+size).reduce((a,b)=>a*256+b,0);if(id==='ba')out.height=bytes.subarray(body,body+size).reduce((a,b)=>a*256+b,0);
        if(id==='4489')out.duration=new DataView(bytes.buffer,bytes.byteOffset+body,8).getFloat64(0)/1000;if(id==='a3'){out.blocks++;if((bytes[body]&0x7f)===1&&bytes[body+3]&0x80)out.keys++;}}
      o=body+size;}};
    if(bytes[0]!==0x1a||bytes[1]!==0x45)throw Error('Not a WebM file.');walk(bytes.length);return out;
  }
  // ---------------------------------------------------------------- what this system can encode
  // The H.264 level a picture size and rate need (macroblocks per picture and per second, from the standard's table).
  const LEVEL=(w,h,fps)=>{const fs=Math.ceil(w/16)*Math.ceil(h/16),mbs=fs*fps;return mbs<=108000&&fs<=3600?'1f':mbs<=245760&&fs<=8192?'28':mbs<=522240&&fs<=8704?'2a':mbs<=589824&&fs<=22080?'32':mbs<=983040&&fs<=36864?'33':'34';};
  const bitrate=(w,h,fps)=>Math.round(w*h*fps*.2/1e5)*1e5;
  // The video formats the encoders here accept at this size and rate, best first: [{container, codec, config}].
  async function probe({width,height,fps},env=globalThis){
    const VE=env.VideoEncoder,AE=env.AudioEncoder,out=[];if(!VE?.isConfigSupported)return {video:[],audio:{mp4:null,webm:null},webcodecs:false};
    const lv=LEVEL(width,height,fps),base={width,height,framerate:fps,bitrate:bitrate(width,height,fps),latencyMode:'quality'};
    const tries=[['mp4','avc',`avc1.6400${lv}`,{avc:{format:'avc'}}],['mp4','avc',`avc1.4d00${lv}`,{avc:{format:'avc'}}],['mp4','avc',`avc1.42e0${lv}`,{avc:{format:'avc'}}],['webm','vp9','vp09.00.40.08',{}],['webm','vp8','vp8',{}]];
    for(const [container,codec,string,extra] of tries){if(out.some(o=>o.container===container&&o.codec===codec))continue;
      try{const r=await VE.isConfigSupported({...base,codec:string,...extra});if(r?.supported)out.push({container,codec,config:{...base,codec:string,...extra}});}catch{}}
    const audio={mp4:null,webm:null};
    if(AE?.isConfigSupported){for(const [codec,string] of [['aac','mp4a.40.2'],['opus','opus']]){try{const cfg={codec:string,sampleRate:48000,numberOfChannels:2,bitrate:192000},r=await AE.isConfigSupported(cfg);if(r?.supported){if(!audio.mp4)audio.mp4={codec,config:cfg};if(codec==='opus')audio.webm={codec,config:cfg};}}catch{}}}
    return {video:out,audio,webcodecs:true};
  }
  const MP4=withDescriptions(mp4),WEBM=withDescriptions(webm);
  const bytesOf=d=>d instanceof ArrayBuffer?new Uint8Array(d.slice(0)):new Uint8Array(d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength));
  // Opus's identification header for 48 kHz stereo (pre-skip 312), for a WebM track and MP4's dOps.
  function opusHead(){const b=new Uint8Array(19);b.set(te.encode('OpusHead'));const dv=new DataView(b.buffer);b[8]=1;b[9]=2;dv.setUint16(10,312,true);dv.setUint32(12,48000,true);return b;}
  // ---------------------------------------------------------------- encoding
  // Draws and encodes `count` pictures (draw(i) returns a canvas for picture i, maybe after awaiting) and the sound,
  // and returns the file. Pictures are timed exactly i / fps, so the video plays at the speed of the edit however
  // long each picture took to draw. onProgress(done, count); `signal.aborted` stops it with an AbortError.
  async function encode({format,width,height,fps,count,draw,sound,audioFormat,onProgress,signal}){
    if(!format)throw Error('This system has no video encoder the app can use.');
    const muxer=(format.container==='mp4'?MP4:WEBM)({video:{codec:format.codec,width,height,timescale:fps*1000},audio:sound&&audioFormat?{codec:audioFormat.codec,sampleRate:48000,channels:2,bitrate:192000}:null});
    let failure=null,videoMeta=null,audioMeta=null;
    const enc=new VideoEncoder({output:(chunk,meta)=>{if(meta?.decoderConfig?.description&&!videoMeta)videoMeta=bytesOf(meta.decoderConfig.description);
      const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);muxer.addVideo({type:chunk.type,timestamp:chunk.timestamp,duration:chunk.duration,data});},error:e=>{failure=e;}});
    enc.configure({...format.config,width,height,framerate:fps,bitrate:bitrate(width,height,fps)});
    const frameUs=1e6/fps,gop=fps*2;
    try{
      for(let i=0;i<count;i++){
        if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');if(failure)throw failure;
        const canvas=await draw(i),frame=new VideoFrame(canvas,{timestamp:Math.round(i*frameUs),duration:Math.round(frameUs)});
        enc.encode(frame,{keyFrame:i%gop===0});frame.close();
        // Let the encoder catch up rather than queueing every picture in memory.
        while(enc.encodeQueueSize>3&&!failure)await new Promise(r=>setTimeout(r,2));
        onProgress?.(i+1,count);
      }
      await enc.flush();if(failure)throw failure;
    }finally{if(enc.state!=='closed')enc.close();}
    // The writer needs the stream description, which only arrives with the first picture.
    if(format.codec==='avc'&&!videoMeta)throw Error('The H.264 encoder did not describe its stream.');muxer.videoDescription=videoMeta;
    if(sound&&audioFormat){
      const aenc=new AudioEncoder({output:(chunk,meta)=>{if(meta?.decoderConfig?.description&&!audioMeta)audioMeta=bytesOf(meta.decoderConfig.description);
        const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);muxer.addAudio({timestamp:chunk.timestamp,duration:chunk.duration,data});},error:e=>{failure=e;}});
      aenc.configure(audioFormat.config);const block=1024,chans=[sound.getChannelData(0),sound.numberOfChannels>1?sound.getChannelData(1):sound.getChannelData(0)];
      try{for(let s=0;s<sound.length;s+=block){if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');const n=Math.min(block,sound.length-s),data=new Float32Array(n*2);data.set(chans[0].subarray(s,s+n),0);data.set(chans[1].subarray(s,s+n),n);
        const ad=new AudioData({format:'f32-planar',sampleRate:48000,numberOfFrames:n,numberOfChannels:2,timestamp:Math.round(s*1e6/48000),data});aenc.encode(ad);ad.close();while(aenc.encodeQueueSize>8)await new Promise(r=>setTimeout(r,1));}
        await aenc.flush();if(failure)throw failure;}finally{if(aenc.state!=='closed')aenc.close();}
      // Without a description from the encoder, the standard one for 48 kHz stereo.
      muxer.audioDescription=audioMeta||(audioFormat.codec==='aac'?Uint8Array.of(0x11,0x90):opusHead());}
    return muxer.finish();
  }
  return {Bytes,mp4:MP4,webm:WEBM,inspectMp4,inspectWebm,probe,encode,bitrate,LEVEL};
  // The stream descriptions (H.264's avcC, the sound's codec setup) only arrive while encoding; the writer reads
  // them when it finishes.
  function withDescriptions(make){return opts=>{const m=make(opts),api={...m,videoDescription:null,audioDescription:null,finish(){if(api.videoDescription)opts.video.description=api.videoDescription;if(opts.audio&&api.audioDescription)opts.audio.description=api.audioDescription;return m.finish();}};return api;};}
});
