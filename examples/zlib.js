import { dlopen, define, dlerror, dlclose, dlsym, call, errno, RTLD_NOW } from 'ffi';

const libz = dlopen('libz.so.1', RTLD_NOW);

export const Z_NO_FLUSH = 0;
export const Z_PARTIAL_FLUSH = 1;
export const Z_SYNC_FLUSH = 2;
export const Z_FULL_FLUSH = 3;
export const Z_FINISH = 4;
export const Z_BLOCK = 5;
export const Z_TREES = 6;
export const Z_OK = 0;
export const Z_STREAM_END = 1;
export const Z_NEED_DICT = 2;
export const Z_ERRNO = (-1);
export const Z_STREAM_ERROR = (-2);
export const Z_DATA_ERROR = (-3);
export const Z_MEM_ERROR = (-4);
export const Z_BUF_ERROR = (-5);
export const Z_VERSION_ERROR = (-6);
export const Z_NO_COMPRESSION = 0;
export const Z_BEST_SPEED = 1;
export const Z_BEST_COMPRESSION = 9;
export const Z_DEFAULT_COMPRESSION = (-1);
export const Z_FILTERED = 1;
export const Z_HUFFMAN_ONLY = 2;
export const Z_RLE = 3;
export const Z_FIXED = 4;
export const Z_DEFAULT_STRATEGY = 0;
export const Z_BINARY = 0;
export const Z_TEXT = 1;
export const Z_ASCII = Z_TEXT;
export const Z_UNKNOWN = 2;
export const Z_DEFLATED = 8;
export const Z_NULL = 0;

/**       
 * @function zlibVersion     
 * 
 * @return   {String}        
 */
define('zlibVersion', dlsym(libz, 'zlibVersion'), null, 'char *');
function zlibVersion() {
  return call('zlibVersion', );
}

/**       
 * @function deflate         
 * 
 * @param    {Number}        strm
 * @param    {Number}        flush
 * 
 * @return   {Number}        
 */
define('deflate', dlsym(libz, 'deflate'), null, 'int', 'void *', 'int');
function deflate(strm, flush) {
  return call('deflate', strm, flush);
}

/**       
 * @function deflateEnd      
 * 
 * @param    {Number}        strm
 * 
 * @return   {Number}        
 */
define('deflateEnd', dlsym(libz, 'deflateEnd'), null, 'int', 'void *');
function deflateEnd(strm) {
  return call('deflateEnd', strm);
}

/**       
 * @function inflate         
 * 
 * @param    {Number}        strm
 * @param    {Number}        flush
 * 
 * @return   {Number}        
 */
define('inflate', dlsym(libz, 'inflate'), null, 'int', 'void *', 'int');
function inflate(strm, flush) {
  return call('inflate', strm, flush);
}

/**       
 * @function inflateEnd      
 * 
 * @param    {Number}        strm
 * 
 * @return   {Number}        
 */
define('inflateEnd', dlsym(libz, 'inflateEnd'), null, 'int', 'void *');
function inflateEnd(strm) {
  return call('inflateEnd', strm);
}

/**       
 * @function deflateSetDictionary
 * 
 * @param    {Number}        strm
 * @param    {Number}        dictionary
 * @param    {Number}        dictLength
 * 
 * @return   {Number}        
 */
define('deflateSetDictionary', dlsym(libz, 'deflateSetDictionary'), null, 'int', 'void *', 'long', 'unsigned int');
function deflateSetDictionary(strm, dictionary, dictLength) {
  return call('deflateSetDictionary', strm, dictionary, dictLength);
}

/**       
 * @function deflateGetDictionary
 * 
 * @param    {Number}        strm
 * @param    {Number}        dictionary
 * @param    {Number}        dictLength
 * 
 * @return   {Number}        
 */
define('deflateGetDictionary', dlsym(libz, 'deflateGetDictionary'), null, 'int', 'void *', 'long', 'long');
function deflateGetDictionary(strm, dictionary, dictLength) {
  return call('deflateGetDictionary', strm, dictionary, dictLength);
}

/**       
 * @function deflateCopy     
 * 
 * @param    {Number}        dest
 * @param    {Number}        source
 * 
 * @return   {Number}        
 */
define('deflateCopy', dlsym(libz, 'deflateCopy'), null, 'int', 'void *', 'void *');
function deflateCopy(dest, source) {
  return call('deflateCopy', dest, source);
}

/**       
 * @function deflateReset    
 * 
 * @param    {Number}        strm
 * 
 * @return   {Number}        
 */
define('deflateReset', dlsym(libz, 'deflateReset'), null, 'int', 'void *');
function deflateReset(strm) {
  return call('deflateReset', strm);
}

/**       
 * @function deflateParams   
 * 
 * @param    {Number}        strm
 * @param    {Number}        level
 * @param    {Number}        strategy
 * 
 * @return   {Number}        
 */
define('deflateParams', dlsym(libz, 'deflateParams'), null, 'int', 'void *', 'int', 'int');
function deflateParams(strm, level, strategy) {
  return call('deflateParams', strm, level, strategy);
}

/**       
 * @function deflateTune     
 * 
 * @param    {Number}        strm
 * @param    {Number}        good_length
 * @param    {Number}        max_lazy
 * @param    {Number}        nice_length
 * @param    {Number}        max_chain
 * 
 * @return   {Number}        
 */
define('deflateTune', dlsym(libz, 'deflateTune'), null, 'int', 'void *', 'int', 'int', 'int', 'int');
function deflateTune(strm, good_length, max_lazy, nice_length, max_chain) {
  return call('deflateTune', strm, good_length, max_lazy, nice_length, max_chain);
}


/**       
 * @function deflatePending  
 * 
 * @param    {Number}        strm
 * @param    {Number}        pending
 * @param    {Number}        bits
 * 
 * @return   {Number}        
 */
define('deflatePending', dlsym(libz, 'deflatePending'), null, 'int', 'void *', 'unsigned long', 'long');
function deflatePending(strm, pending, bits) {
  return call('deflatePending', strm, pending, bits);
}

/**       
 * @function deflatePrime    
 * 
 * @param    {Number}        strm
 * @param    {Number}        bits
 * @param    {Number}        value
 * 
 * @return   {Number}        
 */
define('deflatePrime', dlsym(libz, 'deflatePrime'), null, 'int', 'void *', 'int', 'int');
function deflatePrime(strm, bits, value) {
  return call('deflatePrime', strm, bits, value);
}

/**       
 * @function deflateSetHeader
 * 
 * @param    {Number}        strm
 * @param    {Number}        head
 * 
 * @return   {Number}        
 */
define('deflateSetHeader', dlsym(libz, 'deflateSetHeader'), null, 'int', 'void *', 'void *');
function deflateSetHeader(strm, head) {
  return call('deflateSetHeader', strm, head);
}

/**       
 * @function inflateSetDictionary
 * 
 * @param    {Number}        strm
 * @param    {Number}        dictionary
 * @param    {Number}        dictLength
 * 
 * @return   {Number}        
 */
define('inflateSetDictionary', dlsym(libz, 'inflateSetDictionary'), null, 'int', 'void *', 'long', 'unsigned int');
function inflateSetDictionary(strm, dictionary, dictLength) {
  return call('inflateSetDictionary', strm, dictionary, dictLength);
}

/**       
 * @function inflateGetDictionary
 * 
 * @param    {Number}        strm
 * @param    {Number}        dictionary
 * @param    {Number}        dictLength
 * 
 * @return   {Number}        
 */
define('inflateGetDictionary', dlsym(libz, 'inflateGetDictionary'), null, 'int', 'void *', 'long', 'long');
function inflateGetDictionary(strm, dictionary, dictLength) {
  return call('inflateGetDictionary', strm, dictionary, dictLength);
}

/**       
 * @function inflateSync     
 * 
 * @param    {Number}        strm
 * 
 * @return   {Number}        
 */
define('inflateSync', dlsym(libz, 'inflateSync'), null, 'int', 'void *');
function inflateSync(strm) {
  return call('inflateSync', strm);
}

/**       
 * @function inflateCopy     
 * 
 * @param    {Number}        dest
 * @param    {Number}        source
 * 
 * @return   {Number}        
 */
define('inflateCopy', dlsym(libz, 'inflateCopy'), null, 'int', 'void *', 'void *');
function inflateCopy(dest, source) {
  return call('inflateCopy', dest, source);
}

/**       
 * @function inflateReset    
 * 
 * @param    {Number}        strm
 * 
 * @return   {Number}        
 */
define('inflateReset', dlsym(libz, 'inflateReset'), null, 'int', 'void *');
function inflateReset(strm) {
  return call('inflateReset', strm);
}

/**       
 * @function inflateReset2   
 * 
 * @param    {Number}        strm
 * @param    {Number}        windowBits
 * 
 * @return   {Number}        
 */
define('inflateReset2', dlsym(libz, 'inflateReset2'), null, 'int', 'void *', 'int');
function inflateReset2(strm, windowBits) {
  return call('inflateReset2', strm, windowBits);
}

/**       
 * @function inflatePrime    
 * 
 * @param    {Number}        strm
 * @param    {Number}        bits
 * @param    {Number}        value
 * 
 * @return   {Number}        
 */
define('inflatePrime', dlsym(libz, 'inflatePrime'), null, 'int', 'void *', 'int', 'int');
function inflatePrime(strm, bits, value) {
  return call('inflatePrime', strm, bits, value);
}

/**       
 * @function inflateMark     
 * 
 * @param    {Number}        strm
 * 
 * @return   {Number}        
 */
define('inflateMark', dlsym(libz, 'inflateMark'), null, 'long', 'void *');
function inflateMark(strm) {
  return call('inflateMark', strm);
}

/**       
 * @function inflateGetHeader
 * 
 * @param    {Number}        strm
 * @param    {Number}        head
 * 
 * @return   {Number}        
 */
define('inflateGetHeader', dlsym(libz, 'inflateGetHeader'), null, 'int', 'void *', 'void *');
function inflateGetHeader(strm, head) {
  return call('inflateGetHeader', strm, head);
}

/**       
 * @function inflateBack     
 * 
 * @param    {Number}        strm
 * @param    {Number}        in
 * @param    {Number}        in_desc
 * @param    {Number}        out
 * @param    {Number}        out_desc
 * 
 * @return   {Number}        
 */
define('inflateBack', dlsym(libz, 'inflateBack'), null, 'int', 'void *', 'void *', 'long', 'void *', 'long');
function inflateBack(strm, in, in_desc, out, out_desc) {
  return call('inflateBack', strm, in, in_desc, out, out_desc);
}

/**       
 * @function inflateBackEnd  
 * 
 * @param    {Number}        strm
 * 
 * @return   {Number}        
 */
define('inflateBackEnd', dlsym(libz, 'inflateBackEnd'), null, 'int', 'void *');
function inflateBackEnd(strm) {
  return call('inflateBackEnd', strm);
}


/**       
 * @function compress        
 * 
 * @param    {Number}        dest
 * @param    {Number}        destLen
 * @param    {Number}        source
 * @param    {Number}        sourceLen
 * 
 * @return   {Number}        
 */
define('compress', dlsym(libz, 'compress'), null, 'int', 'long', 'long', 'long', 'unsigned long');
function compress(dest, destLen, source, sourceLen) {
  return call('compress', dest, destLen, source, sourceLen);
}

/**       
 * @function compress2       
 * 
 * @param    {Number}        dest
 * @param    {Number}        destLen
 * @param    {Number}        source
 * @param    {Number}        sourceLen
 * @param    {Number}        level
 * 
 * @return   {Number}        
 */
define('compress2', dlsym(libz, 'compress2'), null, 'int', 'long', 'long', 'long', 'unsigned long', 'int');
function compress2(dest, destLen, source, sourceLen, level) {
  return call('compress2', dest, destLen, source, sourceLen, level);
}


/**       
 * @function uncompress      
 * 
 * @param    {Number}        dest
 * @param    {Number}        destLen
 * @param    {Number}        source
 * @param    {Number}        sourceLen
 * 
 * @return   {Number}        
 */
define('uncompress', dlsym(libz, 'uncompress'), null, 'int', 'long', 'long', 'long', 'unsigned long');
function uncompress(dest, destLen, source, sourceLen) {
  return call('uncompress', dest, destLen, source, sourceLen);
}

/**       
 * @function uncompress2     
 * 
 * @param    {Number}        dest
 * @param    {Number}        destLen
 * @param    {Number}        source
 * @param    {Number}        sourceLen
 * 
 * @return   {Number}        
 */
define('uncompress2', dlsym(libz, 'uncompress2'), null, 'int', 'long', 'long', 'long', 'long');
function uncompress2(dest, destLen, source, sourceLen) {
  return call('uncompress2', dest, destLen, source, sourceLen);
}


/**       
 * @function gzbuffer        
 * 
 * @param    {Number}        file
 * @param    {Number}        size
 * 
 * @return   {Number}        
 */
define('gzbuffer', dlsym(libz, 'gzbuffer'), null, 'int', 'void *', 'unsigned int');
function gzbuffer(file, size) {
  return call('gzbuffer', file, size);
}

/**       
 * @function gzsetparams     
 * 
 * @param    {Number}        file
 * @param    {Number}        level
 * @param    {Number}        strategy
 * 
 * @return   {Number}        
 */
define('gzsetparams', dlsym(libz, 'gzsetparams'), null, 'int', 'void *', 'int', 'int');
function gzsetparams(file, level, strategy) {
  return call('gzsetparams', file, level, strategy);
}

/**       
 * @function gzread          
 * 
 * @param    {Number}        file
 * @param    {Number}        buf
 * @param    {Number}        len
 * 
 * @return   {Number}        
 */
define('gzread', dlsym(libz, 'gzread'), null, 'int', 'void *', 'void *', 'unsigned int');
function gzread(file, buf, len) {
  return call('gzread', file, buf, len);
}


/**       
 * @function gzwrite         
 * 
 * @param    {Number}        file
 * @param    {Number}        buf
 * @param    {Number}        len
 * 
 * @return   {Number}        
 */
define('gzwrite', dlsym(libz, 'gzwrite'), null, 'int', 'void *', 'void *', 'unsigned int');
function gzwrite(file, buf, len) {
  return call('gzwrite', file, buf, len);
}


/**       
 * @function gzprintf        
 * 
 * @param    {Number}        file
 * @param    {String}        format
 * 
 * @return   {Number}        
 */
define('gzprintf', dlsym(libz, 'gzprintf'), null, 'int', 'void *', 'char *');
function gzprintf(file, format) {
  return call('gzprintf', file, format);
}

/**       
 * @function gzputs          
 * 
 * @param    {Number}        file
 * @param    {String}        s
 * 
 * @return   {Number}        
 */
define('gzputs', dlsym(libz, 'gzputs'), null, 'int', 'void *', 'char *');
function gzputs(file, s) {
  return call('gzputs', file, s);
}

/**       
 * @function gzgets          
 * 
 * @param    {Number}        file
 * @param    {String}        buf
 * @param    {Number}        len
 * 
 * @return   {String}        
 */
define('gzgets', dlsym(libz, 'gzgets'), null, 'char *', 'void *', 'char *', 'int');
function gzgets(file, buf, len) {
  return call('gzgets', file, buf, len);
}

/**       
 * @function gzputc          
 * 
 * @param    {Number}        file
 * @param    {Number}        c
 * 
 * @return   {Number}        
 */
define('gzputc', dlsym(libz, 'gzputc'), null, 'int', 'void *', 'int');
function gzputc(file, c) {
  return call('gzputc', file, c);
}

/**       
 * @function gzgetc          
 * 
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzgetc', dlsym(libz, 'gzgetc'), null, 'int', 'void *');
function gzgetc(file) {
  return call('gzgetc', file);
}

/**       
 * @function gzungetc        
 * 
 * @param    {Number}        c
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzungetc', dlsym(libz, 'gzungetc'), null, 'int', 'int', 'void *');
function gzungetc(c, file) {
  return call('gzungetc', c, file);
}

/**       
 * @function gzflush         
 * 
 * @param    {Number}        file
 * @param    {Number}        flush
 * 
 * @return   {Number}        
 */
define('gzflush', dlsym(libz, 'gzflush'), null, 'int', 'void *', 'int');
function gzflush(file, flush) {
  return call('gzflush', file, flush);
}

/**       
 * @function gzrewind        
 * 
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzrewind', dlsym(libz, 'gzrewind'), null, 'int', 'void *');
function gzrewind(file) {
  return call('gzrewind', file);
}

/**       
 * @function gzeof           
 * 
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzeof', dlsym(libz, 'gzeof'), null, 'int', 'void *');
function gzeof(file) {
  return call('gzeof', file);
}

/**       
 * @function gzdirect        
 * 
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzdirect', dlsym(libz, 'gzdirect'), null, 'int', 'void *');
function gzdirect(file) {
  return call('gzdirect', file);
}

/**       
 * @function gzclose         
 * 
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzclose', dlsym(libz, 'gzclose'), null, 'int', 'void *');
function gzclose(file) {
  return call('gzclose', file);
}

/**       
 * @function gzclose_r       
 * 
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzclose_r', dlsym(libz, 'gzclose_r'), null, 'int', 'void *');
function gzclose_r(file) {
  return call('gzclose_r', file);
}

/**       
 * @function gzclose_w       
 * 
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzclose_w', dlsym(libz, 'gzclose_w'), null, 'int', 'void *');
function gzclose_w(file) {
  return call('gzclose_w', file);
}

/**       
 * @function gzerror         
 * 
 * @param    {Number}        file
 * @param    {Number}        errnum
 * 
 * @return   {String}        
 */
define('gzerror', dlsym(libz, 'gzerror'), null, 'char *', 'void *', 'long');
function gzerror(file, errnum) {
  return call('gzerror', file, errnum);
}

/**       
 * @function gzclearerr      
 * 
 * @param    {Number}        file
 */
define('gzclearerr', dlsym(libz, 'gzclearerr'), null, 'void', 'void *');
function gzclearerr(file) {
  call('gzclearerr', file);
}





/**       
 * @function deflateInit_    
 * 
 * @param    {Number}        strm
 * @param    {Number}        level
 * @param    {String}        version
 * @param    {Number}        stream_size
 * 
 * @return   {Number}        
 */
define('deflateInit_', dlsym(libz, 'deflateInit_'), null, 'int', 'void *', 'int', 'char *', 'int');
function deflateInit_(strm, level, version, stream_size) {
  return call('deflateInit_', strm, level, version, stream_size);
}

/**       
 * @function inflateInit_    
 * 
 * @param    {Number}        strm
 * @param    {String}        version
 * @param    {Number}        stream_size
 * 
 * @return   {Number}        
 */
define('inflateInit_', dlsym(libz, 'inflateInit_'), null, 'int', 'void *', 'char *', 'int');
function inflateInit_(strm, version, stream_size) {
  return call('inflateInit_', strm, version, stream_size);
}

/**       
 * @function deflateInit2_   
 * 
 * @param    {Number}        strm
 * @param    {Number}        level
 * @param    {Number}        method
 * @param    {Number}        windowBits
 * @param    {Number}        memLevel
 * @param    {Number}        strategy
 * @param    {String}        version
 * @param    {Number}        stream_size
 * 
 * @return   {Number}        
 */
define('deflateInit2_', dlsym(libz, 'deflateInit2_'), null, 'int', 'void *', 'int', 'int', 'int', 'int', 'int', 'char *', 'int');
function deflateInit2_(strm, level, method, windowBits, memLevel, strategy, version, stream_size) {
  return call('deflateInit2_', strm, level, method, windowBits, memLevel, strategy, version, stream_size);
}

/**       
 * @function inflateInit2_   
 * 
 * @param    {Number}        strm
 * @param    {Number}        windowBits
 * @param    {String}        version
 * @param    {Number}        stream_size
 * 
 * @return   {Number}        
 */
define('inflateInit2_', dlsym(libz, 'inflateInit2_'), null, 'int', 'void *', 'int', 'char *', 'int');
function inflateInit2_(strm, windowBits, version, stream_size) {
  return call('inflateInit2_', strm, windowBits, version, stream_size);
}

/**       
 * @function inflateBackInit_
 * 
 * @param    {Number}        strm
 * @param    {Number}        windowBits
 * @param    {Number}        window
 * @param    {String}        version
 * @param    {Number}        stream_size
 * 
 * @return   {Number}        
 */
define('inflateBackInit_', dlsym(libz, 'inflateBackInit_'), null, 'int', 'void *', 'int', 'unsigned long', 'char *', 'int');
function inflateBackInit_(strm, windowBits, window, version, stream_size) {
  return call('inflateBackInit_', strm, windowBits, window, version, stream_size);
}

/**       
 * @function gzgetc_         
 * 
 * @param    {Number}        file
 * 
 * @return   {Number}        
 */
define('gzgetc_', dlsym(libz, 'gzgetc_'), null, 'int', 'void *');
function gzgetc_(file) {
  return call('gzgetc_', file);
}

/**       
 * @function zError          
 * 
 * @param    {Number}        arg1
 * 
 * @return   {String}        
 */
define('zError', dlsym(libz, 'zError'), null, 'char *', 'int');
function zError(arg1) {
  return call('zError', arg1);
}

/**       
 * @function inflateSyncPoint
 * 
 * @param    {Number}        arg1
 * 
 * @return   {Number}        
 */
define('inflateSyncPoint', dlsym(libz, 'inflateSyncPoint'), null, 'int', 'void *');
function inflateSyncPoint(arg1) {
  return call('inflateSyncPoint', arg1);
}

/**       
 * @function get_crc_table   
 * 
 * @return   {Number}        
 */
define('get_crc_table', dlsym(libz, 'get_crc_table'), null, 'void *');
function get_crc_table() {
  return call('get_crc_table', );
}

/**       
 * @function inflateUndermine
 * 
 * @param    {Number}        arg1
 * @param    {Number}        arg2
 * 
 * @return   {Number}        
 */
define('inflateUndermine', dlsym(libz, 'inflateUndermine'), null, 'int', 'void *', 'int');
function inflateUndermine(arg1, arg2) {
  return call('inflateUndermine', arg1, arg2);
}

/**       
 * @function inflateValidate 
 * 
 * @param    {Number}        arg1
 * @param    {Number}        arg2
 * 
 * @return   {Number}        
 */
define('inflateValidate', dlsym(libz, 'inflateValidate'), null, 'int', 'void *', 'int');
function inflateValidate(arg1, arg2) {
  return call('inflateValidate', arg1, arg2);
}

/**       
 * @function inflateCodesUsed
 * 
 * @param    {Number}        arg1
 * 
 * @return   {Number}        
 */
define('inflateCodesUsed', dlsym(libz, 'inflateCodesUsed'), null, 'unsigned long', 'void *');
function inflateCodesUsed(arg1) {
  return call('inflateCodesUsed', arg1);
}

/**       
 * @function inflateResetKeep
 * 
 * @param    {Number}        arg1
 * 
 * @return   {Number}        
 */
define('inflateResetKeep', dlsym(libz, 'inflateResetKeep'), null, 'int', 'void *');
function inflateResetKeep(arg1) {
  return call('inflateResetKeep', arg1);
}

/**       
 * @function deflateResetKeep
 * 
 * @param    {Number}        arg1
 * 
 * @return   {Number}        
 */
define('deflateResetKeep', dlsym(libz, 'deflateResetKeep'), null, 'int', 'void *');
function deflateResetKeep(arg1) {
  return call('deflateResetKeep', arg1);
}

/**       
 * @function gzvprintf       
 * 
 * @param    {Number}        file
 * @param    {String}        format
 * @param    {Number}        va
 * 
 * @return   {Number}        
 */
define('gzvprintf', dlsym(libz, 'gzvprintf'), null, 'int', 'void *', 'char *', 'long');
function gzvprintf(file, format, va) {
  return call('gzvprintf', file, format, va);
}
