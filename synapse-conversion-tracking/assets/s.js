if(!String.prototype.startsWith){Object.defineProperty(String.prototype,"startsWith",{value:function(search,rawPos){var pos=rawPos>0?rawPos|0:0;return this.substring(pos,pos+search.length)===search}})}function dataTagParseResponse(str){try{return JSON.parse(str)}catch(e){return{body:str}}}function dataTagSendData(data,gtmServerDomain,requestPath,dataLayerEventName,dataLayerVariableName,waitForCookies,useFetchInsteadOfXHR){dataLayerEventName=dataLayerEventName||false;dataLayerVariableName=dataLayerVariableName||false;waitForCookies=waitForCookies||false;var replaceVariable=function(a,b){return a.replace(/\$\{([^\}]+)\}/g,function(c,d){return b[d]||c})},xhr=null,sendPixel=function(url){var img=new Image(1,1);if(url.startsWith((gtmServerDomain.charAt(gtmServerDomain.length-1)==="/"?gtmServerDomain.slice(0,-1):gtmServerDomain)+"/_set_cookie")){setCookieRunningCount++;img.onload=img.onerror=function(){img.onload=img.onerror=null;setCookieRunningCount--;if((!xhr||xhr.readyState===4)&&dataLayerEventName&&dataLayerVariableName&&waitForCookies&&setCookieRunningCount===0){pushToDataLayer()}}}img.src=url},sendBeacon=function(url){var sendBeaconResult;try{sendBeaconResult=navigator.sendBeacon&&navigator.sendBeacon(url)}catch(e){}sendBeaconResult||sendPixel(url)},fallbackIterator=function(a){var b=0;return function(){return b<a.length?{done:!1,value:a[b++]}:{done:!0}}},pushToDataLayer=function(){window[dataLayerVariableName]=window[dataLayerVariableName]||[];eventDataLayerData.event=dataLayerEventName;window[dataLayerVariableName].push(eventDataLayerData)},stringifiedData=JSON.stringify(data),response="",loaded=0,replacements={transport_url:gtmServerDomain},eventDataLayerData={},setCookieRunningCount=0,processResponseDataEvent=function(event){if(event){var sendPixelArr=event.send_pixel||[],i;if(Array.isArray(sendPixelArr))for(i=0;i<sendPixelArr.length;i++)sendPixel(sendPixelArr[i]);var sendBeaconArr=event.send_beacon||[];if(Array.isArray(sendBeaconArr))for(i=0;i<sendBeaconArr.length;i++)sendBeacon(sendBeaconArr[i]);if(typeof event.response==="object"){var status=event.response.status_code||0,body=event.response.body||{},parsedBody=dataTagParseResponse(body);for(var key in parsedBody){if(parsedBody.hasOwnProperty(key)){eventDataLayerData[key]=parsedBody[key]}}eventDataLayerData.status=status}}};if(useFetchInsteadOfXHR){fetch(gtmServerDomain+requestPath,{method:"POST",headers:{"Content-Type":"text/plain"},credentials:"include",keepalive:true,body:stringifiedData}).then(function(response){response.text().then(function(responseText){if(responseText){responseText=replaceVariable(responseText,replacements)}if(responseText&&responseText.startsWith("event: message\ndata: ")){responseText.split("\n\n").filter(function(eventString){return eventString}).forEach(function(eventString){try{var event=JSON.parse(eventString.replace("event: message\ndata: ",""));processResponseDataEvent(event)}catch(error){console.error("Error processing response data:",error)}})}if(dataLayerEventName&&dataLayerVariableName){if(!responseText||!responseText.startsWith("event: message\ndata: ")){eventDataLayerData=dataTagParseResponse(responseText);eventDataLayerData.status=response.status;pushToDataLayer()}else if(!waitForCookies||setCookieRunningCount===0){pushToDataLayer()}}})}).catch(function(error){console.error(error)})}else{xhr=new XMLHttpRequest;xhr.open("POST",gtmServerDomain+requestPath);xhr.setRequestHeader("Content-type","text/plain");xhr.withCredentials=true;xhr.onprogress=function(progress){if(xhr.status===200&&xhr.responseText.startsWith("event: message\ndata: ")){response+=xhr.responseText.substring(loaded);loaded=progress.loaded;for(var replacedResponse=replaceVariable(response,replacements),nextSeparationPos=replacedResponse.indexOf("\n\n");-1!==nextSeparationPos;){var parsedData;a:{var iterableLines;var lines=replacedResponse.substring(0,nextSeparationPos).split("\n"),linesIterator="undefined"!=typeof Symbol&&Symbol.iterator&&lines[Symbol.iterator];if(linesIterator)iterableLines=linesIterator.call(lines);else if("number"==typeof lines.length)iterableLines={next:fallbackIterator(lines)};else throw Error(String(lines)+" is not an iterable or ArrayLike");var eventNameLine=iterableLines.next().value,eventDataLine=iterableLines.next().value;if(eventNameLine.startsWith("event: message")&&eventDataLine.startsWith("data: "))try{parsedData=JSON.parse(eventDataLine.substring(eventDataLine.indexOf(":")+1));break a}catch(e){}parsedData=void 0}processResponseDataEvent(parsedData);replacedResponse=replacedResponse.substring(nextSeparationPos+2);nextSeparationPos=replacedResponse.indexOf("\n\n")}}};xhr.onload=function(){if(xhr.status.toString()[0]!=="2"){console.error(xhr.status+"> "+xhr.statusText)}if(dataLayerEventName&&dataLayerVariableName){if(!xhr.responseText.startsWith("event: message\ndata: ")){eventDataLayerData=dataTagParseResponse(xhr.responseText);eventDataLayerData.status=xhr.status;pushToDataLayer()}else if(!waitForCookies||setCookieRunningCount===0){pushToDataLayer()}}};xhr.send(stringifiedData)}}function dataTagGetData(containerId,eventId,useOwnDataModel,useOnlyCurrentEventObj){var dataLayerGTM=window.google_tag_manager[containerId].dataLayer;var dataModelUntilCurrentEvent;var currentEventObj;if(typeof eventId!=="undefined"&&(useOwnDataModel||useOnlyCurrentEventObj)){try{var isObjectEmpty=function(obj){if(typeof obj!=="object")return;for(var key in obj){if(Object.prototype.hasOwnProperty.call(obj,key))return false}return true};var dataLayerName=dataLayerGTM.name;var actualDataLayer=window[dataLayerName];var actualDataLayerLength=actualDataLayer.length;for(var i=actualDataLayerLength-1;i>=0;i--){var obj=actualDataLayer[i];if(!obj||typeof obj!=="object")continue;if(!obj.hasOwnProperty("gtm.uniqueEventId")&&typeof obj.getUntrustedMessageValue==="function"&&typeof obj.value==="object"){obj=obj.value}if(eventId===obj["gtm.uniqueEventId"]){if(useOwnDataModel){dataModelUntilCurrentEvent=dataTagGetOwnDataModel(actualDataLayer.slice(0,i+1));if(typeof dataModelUntilCurrentEvent!=="object"||isObjectEmpty(dataModelUntilCurrentEvent)){dataModelUntilCurrentEvent=null}}else if(useOnlyCurrentEventObj){currentEventObj=obj}break}}}catch(e){}}window.dataTagData={document:{characterSet:window.document.characterSet},innerWidth:window.innerWidth,innerHeight:window.innerHeight,screen:{width:window.screen.width,height:window.screen.height},dataModel:dataModelUntilCurrentEvent||currentEventObj||dataLayerGTM.get({split:function(){return[]}})};return window.dataTagData}function dataTagGetOwnDataModel(dataLayerArray){try{var dataModel={};var typesRegex=/\[object (Boolean|Number|String|Function|Array|Date|RegExp)\]/;var getValueType=function(a){if(a==null)return String(a);var b=typesRegex.exec(Object.prototype.toString.call(Object(a)));return b?b[1].toLowerCase():"object"};var hasOwnProperty=function(a,b){return Object.prototype.hasOwnProperty.call(Object(a),b)};var isString=function(a){return typeof a==="string"};var isArguments=function(a){return!!a&&(Object.prototype.toString.call(a)==="[object Arguments]"||Object.prototype.hasOwnProperty.call(a,"callee"))};var isPlainObject=function(a){if(!a||getValueType(a)!="object"||a.nodeType||a.window&&a==a.window||isArguments(a)){return!1}try{if(a.constructor&&!hasOwnProperty(a,"constructor")&&!hasOwnProperty(a.constructor.prototype,"isPrototypeOf")){return!1}}catch(c){return!1}for(var b in a);return b===void 0||hasOwnProperty(a,b)};var recursiveMerge=function(a,b){var c=b||(getValueType(a)=="array"?[]:{}),d;for(d in a){if(d==="__proto__"||d==="constructor"||d==="prototype"){continue}if(hasOwnProperty(a,d)){var e=a[d];if(getValueType(e)=="array"){getValueType(c[d])!="array"&&(c[d]=[]);c[d]=recursiveMerge(e,c[d])}else if(isPlainObject(e)){isPlainObject(c[d])||(c[d]={});c[d]=recursiveMerge(e,c[d])}else{c[d]=e}}}return c};var cloneObject=function(a){if(getValueType(a)=="array"||isPlainObject(a)){return recursiveMerge(a,null)}return a};var convertDotNotationToNestedObject=function(a,b){var c={},d=c,e=a.split("."),f=0;for(f=0;f<e.length-1;f++){d=d[e[f]]={}}d[e[e.length-1]]=b;return c};if(!Array.isArray(dataLayerArray))return;for(var i=0;i<dataLayerArray.length;i++){delete dataModel.eventModel;var item=dataLayerArray[i];var isGtagCommand=false;if(isArguments(item)){var command=item[0];var processedItem=null;if(command==="js"&&item.length>=2&&item[1].getTime){processedItem={event:"gtm.js","gtm.start":item[1].getTime()}}else if(command==="set"){if(item.length===2&&isPlainObject(item[1])){processedItem=cloneObject(item[1])}else if(item.length===3&&isString(item[1])){processedItem={};var valueToSet=item[2];if(isPlainObject(valueToSet)||getValueType(valueToSet)=="array"){processedItem[item[1]]=cloneObject(valueToSet)}else{processedItem[item[1]]=valueToSet}}}else if(command==="event"&&item.length>=2&&isString(item[1])){var eventParams=item.length>2&&isPlainObject(item[2])?cloneObject(item[2]):{};processedItem={event:item[1],eventModel:eventParams}}if(processedItem){if(item["gtm.uniqueEventId"]){processedItem["gtm.uniqueEventId"]=item["gtm.uniqueEventId"]}isGtagCommand=true;item=processedItem}}if(item&&typeof item==="object"&&typeof item.getUntrustedMessageValue==="function"&&typeof item.value==="object"){item=item.value}if(!isPlainObject(item))continue;var shouldClear=isGtagCommand||!!item._clear;for(var key in item){if(hasOwnProperty(item,key)&&key!=="_clear"){if(shouldClear){var clearObject=convertDotNotationToNestedObject(key,undefined);recursiveMerge(clearObject,dataModel)}var newNestedObject=convertDotNotationToNestedObject(key,item[key]);recursiveMerge(newNestedObject,dataModel)}}}return dataModel}catch(e){}}function dataTagMD5(inputString){var hc="0123456789abcdef";function rh(n){var j,s="";for(j=0;j<=3;j++)s+=hc.charAt(n>>j*8+4&15)+hc.charAt(n>>j*8&15);return s}function ad(x,y){var l=(x&65535)+(y&65535);var m=(x>>16)+(y>>16)+(l>>16);return m<<16|l&65535}function rl(n,c){return n<<c|n>>>32-c}function cm(q,a,b,x,s,t){return ad(rl(ad(ad(a,q),ad(x,t)),s),b)}function ff(a,b,c,d,x,s,t){return cm(b&c|~b&d,a,b,x,s,t)}function gg(a,b,c,d,x,s,t){return cm(b&d|c&~d,a,b,x,s,t)}function hh(a,b,c,d,x,s,t){return cm(b^c^d,a,b,x,s,t)}function ii(a,b,c,d,x,s,t){return cm(c^(b|~d),a,b,x,s,t)}function sb(x){var i;var nblk=(x.length+8>>6)+1;var blks=new Array(nblk*16);for(i=0;i<nblk*16;i++)blks[i]=0;for(i=0;i<x.length;i++)blks[i>>2]|=x.charCodeAt(i)<<i%4*8;blks[i>>2]|=128<<i%4*8;blks[nblk*16-2]=x.length*8;return blks}var i,x=sb(inputString),a=1732584193,b=-271733879,c=-1732584194,d=271733878,olda,oldb,oldc,oldd;for(i=0;i<x.length;i+=16){olda=a;oldb=b;oldc=c;oldd=d;a=ff(a,b,c,d,x[i+0],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i+0],20,-373897302);a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,-35309556);a=hh(a,b,c,d,x[i+1],4,-1530992060);d=hh(d,a,b,c,x[i+4],11,1272893353);c=hh(c,d,a,b,x[i+7],16,-155497632);b=hh(b,c,d,a,x[i+10],23,-1094730640);a=hh(a,b,c,d,x[i+13],4,681279174);d=hh(d,a,b,c,x[i+0],11,-358537222);c=hh(c,d,a,b,x[i+3],16,-722521979);b=hh(b,c,d,a,x[i+6],23,76029189);a=hh(a,b,c,d,x[i+9],4,-640364487);d=hh(d,a,b,c,x[i+12],11,-421815835);c=hh(c,d,a,b,x[i+15],16,530742520);b=hh(b,c,d,a,x[i+2],23,-995338651);a=ii(a,b,c,d,x[i+0],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);a=ad(a,olda);b=ad(b,oldb);c=ad(c,oldc);d=ad(d,oldd)}return rh(a)+rh(b)+rh(c)+rh(d)}!function(t,r){(t="undefined"!=typeof globalThis?globalThis:t||self).dataTagJsSHA=r()}(this,function(){"use strict";var t=function(r,n){return(t=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(t,r){t.__proto__=r}||function(t,r){for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(t[n]=r[n])})(r,n)};var r="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";function n(t,r,n,i){var e,o,u,s=r||[0],f=(n=n||0)>>>3,h=-1===i?3:0;for(e=0;e<t.length;e+=1)o=(u=e+f)>>>2,s.length<=o&&s.push(0),s[o]|=t[e]<<8*(h+i*(u%4));return{value:s,binLen:8*t.length+n}}function i(t,i,e){switch(i){case"UTF8":case"UTF16BE":case"UTF16LE":break;default:throw new Error("encoding must be UTF8, UTF16BE, or UTF16LE")}switch(t){case"HEX":return function(t,r,n){return function(t,r,n,i){var e,o,u,s;if(0!=t.length%2)throw new Error("String of HEX type must be in byte increments");var f=r||[0],h=(n=n||0)>>>3,a=-1===i?3:0;for(e=0;e<t.length;e+=2){if(o=parseInt(t.substr(e,2),16),isNaN(o))throw new Error("String of HEX type contains invalid characters");for(u=(s=(e>>>1)+h)>>>2;f.length<=u;)f.push(0);f[u]|=o<<8*(a+i*(s%4))}return{value:f,binLen:4*t.length+n}}(t,r,n,e)};case"TEXT":return function(t,r,n){return function(t,r,n,i,e){var o,u,s,f,h,a,c,w,v=0,E=n||[0],A=(i=i||0)>>>3;if("UTF8"===r)for(c=-1===e?3:0,s=0;s<t.length;s+=1)for(u=[],128>(o=t.charCodeAt(s))?u.push(o):2048>o?(u.push(192|o>>>6),u.push(128|63&o)):55296>o||57344<=o?u.push(224|o>>>12,128|o>>>6&63,128|63&o):(s+=1,o=65536+((1023&o)<<10|1023&t.charCodeAt(s)),u.push(240|o>>>18,128|o>>>12&63,128|o>>>6&63,128|63&o)),f=0;f<u.length;f+=1){for(h=(a=v+A)>>>2;E.length<=h;)E.push(0);E[h]|=u[f]<<8*(c+e*(a%4)),v+=1}else for(c=-1===e?2:0,w="UTF16LE"===r&&1!==e||"UTF16LE"!==r&&1===e,s=0;s<t.length;s+=1){for(o=t.charCodeAt(s),!0===w&&(o=(f=255&o)<<8|o>>>8),h=(a=v+A)>>>2;E.length<=h;)E.push(0);E[h]|=o<<8*(c+e*(a%4)),v+=2}return{value:E,binLen:8*v+i}}(t,i,r,n,e)};case"B64":return function(t,n,i){return function(t,n,i,e){var o,u,s,f,h,a,c=0,w=n||[0],v=(i=i||0)>>>3,E=-1===e?3:0,A=t.indexOf("=");if(-1===t.search(/^[a-zA-Z0-9=+/]+$/))throw new Error("Invalid character in base-64 string");if(t=t.replace(/=/g,""),-1!==A&&A<t.length)throw new Error("Invalid '=' found in base-64 string");for(o=0;o<t.length;o+=4){for(f=t.substr(o,4),s=0,u=0;u<f.length;u+=1)s|=r.indexOf(f.charAt(u))<<18-6*u;for(u=0;u<f.length-1;u+=1){for(h=(a=c+v)>>>2;w.length<=h;)w.push(0);w[h]|=(s>>>16-8*u&255)<<8*(E+e*(a%4)),c+=1}}return{value:w,binLen:8*c+i}}(t,n,i,e)};case"BYTES":return function(t,r,n){return function(t,r,n,i){var e,o,u,s,f=r||[0],h=(n=n||0)>>>3,a=-1===i?3:0;for(o=0;o<t.length;o+=1)e=t.charCodeAt(o),u=(s=o+h)>>>2,f.length<=u&&f.push(0),f[u]|=e<<8*(a+i*(s%4));return{value:f,binLen:8*t.length+n}}(t,r,n,e)};case"ARRAYBUFFER":try{new ArrayBuffer(0)}catch(t){throw new Error("ARRAYBUFFER not supported by this environment")}return function(t,r,i){return function(t,r,i,e){return n(new Uint8Array(t),r,i,e)}(t,r,i,e)};case"UINT8ARRAY":try{new Uint8Array(0)}catch(t){throw new Error("UINT8ARRAY not supported by this environment")}return function(t,r,i){return n(t,r,i,e)};default:throw new Error("format must be HEX, TEXT, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY")}}function e(t,n,i,e){switch(t){case"HEX":return function(t){return function(t,r,n,i){var e,o,u="",s=r/8,f=-1===n?3:0;for(e=0;e<s;e+=1)o=t[e>>>2]>>>8*(f+n*(e%4)),u+="0123456789abcdef".charAt(o>>>4&15)+"0123456789abcdef".charAt(15&o);return i.outputUpper?u.toUpperCase():u}(t,n,i,e)};case"B64":return function(t){return function(t,n,i,e){var o,u,s,f,h,a="",c=n/8,w=-1===i?3:0;for(o=0;o<c;o+=3)for(f=o+1<c?t[o+1>>>2]:0,h=o+2<c?t[o+2>>>2]:0,s=(t[o>>>2]>>>8*(w+i*(o%4))&255)<<16|(f>>>8*(w+i*((o+1)%4))&255)<<8|h>>>8*(w+i*((o+2)%4))&255,u=0;u<4;u+=1)a+=8*o+6*u<=n?r.charAt(s>>>6*(3-u)&63):e.b64Pad;return a}(t,n,i,e)};case"BYTES":return function(t){return function(t,r,n){var i,e,o="",u=r/8,s=-1===n?3:0;for(i=0;i<u;i+=1)e=t[i>>>2]>>>8*(s+n*(i%4))&255,o+=String.fromCharCode(e);return o}(t,n,i)};case"ARRAYBUFFER":try{new ArrayBuffer(0)}catch(t){throw new Error("ARRAYBUFFER not supported by this environment")}return function(t){return function(t,r,n){var i,e=r/8,o=new ArrayBuffer(e),u=new Uint8Array(o),s=-1===n?3:0;for(i=0;i<e;i+=1)u[i]=t[i>>>2]>>>8*(s+n*(i%4))&255;return o}(t,n,i)};case"UINT8ARRAY":try{new Uint8Array(0)}catch(t){throw new Error("UINT8ARRAY not supported by this environment")}return function(t){return function(t,r,n){var i,e=r/8,o=-1===n?3:0,u=new Uint8Array(e);for(i=0;i<e;i+=1)u[i]=t[i>>>2]>>>8*(o+n*(i%4))&255;return u}(t,n,i)};default:throw new Error("format must be HEX, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY")}}var o=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],u=[3238371032,914150663,812702999,4144912697,4290775857,1750603025,1694076839,3204075428],s=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];function f(t){var r={outputUpper:!1,b64Pad:"=",outputLen:-1},n=t||{},i="Output length must be a multiple of 8";if(r.outputUpper=n.outputUpper||!1,n.b64Pad&&(r.b64Pad=n.b64Pad),n.outputLen){if(n.outputLen%8!=0)throw new Error(i);r.outputLen=n.outputLen}else if(n.shakeLen){if(n.shakeLen%8!=0)throw new Error(i);r.outputLen=n.shakeLen}if("boolean"!=typeof r.outputUpper)throw new Error("Invalid outputUpper formatting option");if("string"!=typeof r.b64Pad)throw new Error("Invalid b64Pad formatting option");return r}function h(t,r){return t>>>r|t<<32-r}function a(t,r){return t>>>r}function c(t,r,n){return t&r^~t&n}function w(t,r,n){return t&r^t&n^r&n}function v(t){return h(t,2)^h(t,13)^h(t,22)}function E(t,r){var n=(65535&t)+(65535&r);return(65535&(t>>>16)+(r>>>16)+(n>>>16))<<16|65535&n}function A(t,r,n,i){var e=(65535&t)+(65535&r)+(65535&n)+(65535&i);return(65535&(t>>>16)+(r>>>16)+(n>>>16)+(i>>>16)+(e>>>16))<<16|65535&e}function p(t,r,n,i,e){var o=(65535&t)+(65535&r)+(65535&n)+(65535&i)+(65535&e);return(65535&(t>>>16)+(r>>>16)+(n>>>16)+(i>>>16)+(e>>>16)+(o>>>16))<<16|65535&o}function d(t){return h(t,7)^h(t,18)^a(t,3)}function l(t){return h(t,6)^h(t,11)^h(t,25)}function R(t){return"SHA-224"==t?u.slice():s.slice()}function y(t,r){var n,i,e,u,s,f,R,y,U,b,T,m,F=[];for(n=r[0],i=r[1],e=r[2],u=r[3],s=r[4],f=r[5],R=r[6],y=r[7],T=0;T<64;T+=1)F[T]=T<16?t[T]:A(h(m=F[T-2],17)^h(m,19)^a(m,10),F[T-7],d(F[T-15]),F[T-16]),U=p(y,l(s),c(s,f,R),o[T],F[T]),b=E(v(n),w(n,i,e)),y=R,R=f,f=s,s=E(u,U),u=e,e=i,i=n,n=E(U,b);return r[0]=E(n,r[0]),r[1]=E(i,r[1]),r[2]=E(e,r[2]),r[3]=E(u,r[3]),r[4]=E(s,r[4]),r[5]=E(f,r[5]),r[6]=E(R,r[6]),r[7]=E(y,r[7]),r}return function(r){function n(t,n,e){var o=this;if("SHA-224"!==t&&"SHA-256"!==t)throw new Error("Chosen SHA variant is not supported");var u=e||{};return(o=r.call(this,t,n,e)||this).t=o.i,o.o=!0,o.u=-1,o.s=i(o.h,o.v,o.u),o.A=y,o.p=function(t){return t.slice()},o.l=R,o.R=function(r,n,i,e){return function(t,r,n,i,e){for(var o,u=15+(r+65>>>9<<4),s=r+n;t.length<=u;)t.push(0);for(t[r>>>5]|=128<<24-r%32,t[u]=4294967295&s,t[u-1]=s/4294967296|0,o=0;o<t.length;o+=16)i=y(t.slice(o,o+16),i);return"SHA-224"===e?[i[0],i[1],i[2],i[3],i[4],i[5],i[6]]:i}(r,n,i,e,t)},o.U=R(t),o.T=512,o.m="SHA-224"===t?224:256,o.F=!1,u.hmacKey&&o.B(function(t,r,n,e){var o=t+" must include a value and format";if(!r){if(!e)throw new Error(o);return e}if(void 0===r.value||!r.format)throw new Error(o);return i(r.format,r.encoding||"UTF8",n)(r.value)}("hmacKey",u.hmacKey,o.u)),o}return function(r,n){function i(){this.constructor=r}t(r,n),r.prototype=null===n?Object.create(n):(i.prototype=n.prototype,new i)}(n,r),n}(function(){function t(t,r,n){var i=n||{};if(this.h=r,this.v=i.encoding||"UTF8",this.numRounds=i.numRounds||1,isNaN(this.numRounds)||this.numRounds!==parseInt(this.numRounds,10)||1>this.numRounds)throw new Error("numRounds must a integer >= 1");this.g=t,this.Y=[],this.H=0,this.S=!1,this.I=0,this.C=!1,this.L=[],this.N=[]}return t.prototype.update=function(t){var r,n=0,i=this.T>>>5,e=this.s(t,this.Y,this.H),o=e.binLen,u=e.value,s=o>>>5;for(r=0;r<s;r+=i)n+this.T<=o&&(this.U=this.A(u.slice(r,r+i),this.U),n+=this.T);this.I+=n,this.Y=u.slice(n>>>5),this.H=o%this.T,this.S=!0},t.prototype.getHash=function(t,r){var n,i,o=this.m,u=f(r);if(this.F){if(-1===u.outputLen)throw new Error("Output length must be specified in options");o=u.outputLen}var s=e(t,o,this.u,u);if(this.C&&this.t)return s(this.t(u));for(i=this.R(this.Y.slice(),this.H,this.I,this.p(this.U),o),n=1;n<this.numRounds;n+=1)this.F&&o%32!=0&&(i[i.length-1]&=16777215>>>24-o%32),i=this.R(i,o,0,this.l(this.g),o);return s(i)},t.prototype.setHMACKey=function(t,r,n){if(!this.o)throw new Error("Variant does not support HMAC");if(this.S)throw new Error("Cannot set MAC key after calling update");var e=i(r,(n||{}).encoding||"UTF8",this.u);this.B(e(t))},t.prototype.B=function(t){var r,n=this.T>>>3,i=n/4-1;if(1!==this.numRounds)throw new Error("Cannot set numRounds with MAC");if(this.C)throw new Error("MAC key already set");for(n<t.binLen/8&&(t.value=this.R(t.value,t.binLen,0,this.l(this.g),this.m));t.value.length<=i;)t.value.push(0);for(r=0;r<=i;r+=1)this.L[r]=909522486^t.value[r],this.N[r]=1549556828^t.value[r];this.U=this.A(this.L,this.U),this.I=this.T,this.C=!0},t.prototype.getHMAC=function(t,r){var n=f(r);return e(t,this.m,this.u,n)(this.i())},t.prototype.i=function(){var t;if(!this.C)throw new Error("Cannot call getHMAC without first setting MAC key");var r=this.R(this.Y.slice(),this.H,this.I,this.p(this.U),this.m);return t=this.A(this.N,this.l(this.g)),t=this.R(r,this.m,this.T,t,this.m)},t}())});function dataTag256(inputString,type){var sha256=new dataTagJsSHA("SHA-256","TEXT");sha256.update(inputString);return sha256.getHash(type)};
/*!
 * Synapse Conversion Tracking - edge sender tail (v2.0.0)
 *
 * Concatenated after the vendored Data Tag sender core into assets/s.js, which
 * the edge worker serves as one immutable first-party file. Everything here used
 * to travel inline in every page's <head>; moving it into the cached file cuts
 * the inline block by roughly two thirds while keeping identical behaviour.
 *
 * Ordering guarantee that makes the move safe: the container loader is gated
 * behind THIS file's load (see get_edge_sender_boot_js), so every wrapper
 * installed here is in place before the GTM container - and therefore before any
 * Data Tag or Google tag hit - ever runs.
 *
 * Site-specific configuration is read from window.__synCfg, emitted inline by
 * the plugin, so this file stays byte-identical for every tenant and caches
 * once at the edge:
 *   p - container URL path prefix, e.g. "/lmr"
 *   t - GA4 measurement id for the recovery watchdog, "" when disabled
 *   c - raw web container id, e.g. "GTM-XXXXXXX"
 *   s - data-layer custom event suffix, "" for whitelist mode
 *   d - 1 when the Data Client transport rescue is enabled
 *
 * Everything fails open: any error leaves the page untouched. Nothing here can
 * block a request, and no wrapper ever swallows a call.
 */
(function (w, d) {
  try {
    if (w.__synTail) { return; }

    var CFG = w.__synCfg || {};
    var P = typeof CFG.p === 'string' ? CFG.p : '';
    var O = w.location && w.location.origin;
    var SIGNALLED = {};

    /* ----------------------------------------------------------------
     * 1. Loaded-cache seed
     *
     * The Data Tag template skips injecting its own sender when the URL it
     * would inject is already marked true in gtm_dataTagScriptLoadedCache.
     * That URL is "<third-party CDN>/dtag/v<N>.js" - the CDN sits on the
     * EasyPrivacy list, so in Brave (and any blocker using it) the injection
     * fails and every POST-shaped event is lost. Seeding the key makes the
     * template call the first-party copy loaded above instead.
     *
     * The key prefix is base64-decoded at runtime so the third-party brand
     * string never appears in this file or in the page source.
     *
     * SEED_LO..SEED_HI is the range of template versions covered. The current
     * template is v9; the window reaches three versions ahead so a template
     * update keeps working instead of silently falling back to the blocked
     * CDN injection. Widening it is a deliberate edit: every version inside
     * the window is a version whose payload contract we are asserting the
     * vendored core still satisfies. The signature tripwire in section 2 and
     * dev-tools/template-drift-check.mjs are what make a broken assertion
     * loud instead of silent.
     * ---------------------------------------------------------------- */
    var SEED_LO = 9;
    var SEED_HI = 12;
    var PREFIX = '';

    try {
      PREFIX = w.atob('aHR0cHM6Ly9zdGFwZWNkbi5jb20vZHRhZy8=');
      var k = 'gtm_dataTagScriptLoadedCache';
      var cache = w[k] = w[k] || {};
      for (var i = SEED_LO; i <= SEED_HI; i++) {
        cache[PREFIX + 'v' + i + '.js'] = true;
      }
    } catch (x) { /* seeding is best-effort; template self-injects if it fails */ }

    /* One 1x1 pixel per signal class per page. Deliberately a bare Image GET:
     * the ad-blocker shim only wraps fetch/XHR/sendBeacon, so this arrives at
     * the worker verbatim and lands in the request log for the panel to read.
     * Never fires on a healthy page. */
    function sig(kind, note) {
      try {
        if (SIGNALLED[kind] || !P || !O || !w.Image) { return; }
        SIGNALLED[kind] = 1;
        var px = new w.Image(1, 1);
        px.src = O + P + '/_sg?k=' + encodeURIComponent(kind) +
          '&n=' + encodeURIComponent(String(note).slice(0, 40)) + '&_syng=1';
      } catch (x) { /* never let observability break delivery */ }
    }

    /* Published so the rest of the plugin can report an anomaly through the
     * same channel - assets/js/javascript.js raises "cart_state" here when the
     * cart-state request fails. Guarded at every call site, so a page without
     * the tail simply has no signals. */
    try { w.__synSig = sig; } catch (x) { /* frozen window */ }

    /* ----------------------------------------------------------------
     * 2. Signature tripwire
     *
     * Guards the contract between the template and the vendored core. The
     * template calls dataTagSendData with exactly 7 positional arguments
     * (data, serverDomain, requestPath, dlEventName, dlVariableName,
     * waitForCookies, useFetchInsteadOfXHR) and dataTagGetData with 4. If a
     * future template version changes either shape, the core would receive
     * mismatched arguments and quietly send wrong data - the one failure mode
     * that does not announce itself.
     *
     * The wrappers NEVER block: they inspect, signal at most once, and always
     * forward the original arguments to the original function. A tripped
     * tripwire means "look at the panel", not "tracking stopped".
     *
     * The named parameters keep Function.length at 7 and 4, so any template
     * that ever feature-detects by arity is not misled.
     * ---------------------------------------------------------------- */
    try {
      var realSend = w.dataTagSendData;
      if (typeof realSend === 'function' && !realSend.__syn) {
        var send = function (a1, a2, a3, a4, a5, a6, a7) {
          try {
            var a = arguments;
            if (a.length !== 7 ||
              !a[0] || typeof a[0] !== 'object' ||
              typeof a[1] !== 'string' || a[1].slice(0, 4) !== 'http' ||
              typeof a[2] !== 'string' || a[2].charAt(0) !== '/') {
              sig('send_sig', a.length);
            }
          } catch (x) { /* inspection must never affect the call */ }
          return realSend.apply(this, arguments);
        };
        send.__syn = 1;
        w.dataTagSendData = send;
      }

      var realGet = w.dataTagGetData;
      if (typeof realGet === 'function' && !realGet.__syn) {
        var get = function (a1, a2, a3, a4) {
          try {
            if (arguments.length !== 4) { sig('get_sig', arguments.length); }
          } catch (x) { /* inspection must never affect the call */ }
          return realGet.apply(this, arguments);
        };
        get.__syn = 1;
        w.dataTagGetData = get;
      }
    } catch (x) { /* leave the originals untouched on any error */ }

    /* ----------------------------------------------------------------
     * 3. Injection detector
     *
     * The only way the template reaches its own injectScript call is a seed
     * miss - i.e. it wants a version outside SEED_LO..SEED_HI. That is
     * exactly the event worth knowing about, because in Brave it means lost
     * POSTs. Four cheap polls of document.scripts instead of a live observer:
     * no permanent cost on a heavy DOM, and the signal carries only the
     * script URL or version filename (no user data).
     *
     * Two matches, not one. The exact-prefix match reports the familiar
     * "v<N>.js" note. The second match is the CDN path shape alone (the
     * "/dtag/" segment, derived at runtime from the decoded prefix so no new
     * literal appears in this file): if a future template moves the sender to
     * a DIFFERENT host, the injection is still reported instead of becoming
     * invisible - a host change would otherwise silently kill Brave-class
     * POST events with no signal at all. The note then carries the head of
     * the foreign URL so the panel shows where the template went.
     * ---------------------------------------------------------------- */
    try {
      if (PREFIX && w.setTimeout && d && d.scripts) {
        var si = PREFIX.indexOf('/', 8);
        var SHAPE = si > 0 && PREFIX.length - si > 2 ? PREFIX.slice(si) : '';
        var checkInjection = function () {
          try {
            for (var j = 0; j < d.scripts.length; j++) {
              var src = String(d.scripts[j].src || '');
              if (src.slice(0, PREFIX.length) === PREFIX) {
                sig('cdn_inject', src.slice(PREFIX.length));
                return;
              }
              if (SHAPE && src.indexOf(SHAPE) > 0) {
                sig('cdn_inject', src);
                return;
              }
            }
          } catch (x) { /* polling is best-effort */ }
        };
        var delays = [2000, 5000, 10000, 30000];
        for (var n = 0; n < delays.length; n++) { w.setTimeout(checkInjection, delays[n]); }
      }
    } catch (x) { /* detector is optional */ }

    /* ----------------------------------------------------------------
     * 4. Data Client transport rescue
     *
     * If a Data Tag POST is attempted and provably fails in transit (fetch
     * rejection, beacon refusal, XHR network error - never on an HTTP
     * response of any status), the exact payload is resent once as the Data
     * Client's own GET pixel form: the body base64-encoded into "dtdc". The
     * Data Client parses both forms into the same event model, so the rescued
     * event is byte-identical, event_id included. Rescued hits carry
     * "_synr=1" so they stay identifiable in the request log.
     *
     * Byte-for-byte the wrappers that shipped inline in v1.6.x; only their
     * location changed. They sit on top of the shim's, so they observe the
     * plain pre-encoding URLs and bodies, while the rescue pixel itself is a
     * bare Image - the same naked first-party shape as the Data Tag's own
     * small pixels, which is exactly the transport that passes.
     * ---------------------------------------------------------------- */
    if (CFG.d && P && O) {
      try {
        if (!w.__synDataRescue) {
          w.__synDataRescue = 1;

          var dc = function (u) {
            try {
              var a = new URL(u, w.location.href);
              if (a.origin !== O) { return null; }
              if (a.pathname.slice(0, P.length + 1) !== P + '/') { return null; }
              var r = a.pathname.slice(P.length);
              if (r !== '/data' && r !== '/data/') { return null; }
              return a;
            } catch (x) { return null; }
          };

          var R = function (a, b) {
            try {
              if (!b || typeof b !== 'string') { return; }
              if (a.searchParams && a.searchParams.has('dtdc')) { return; }
              if (!w.Image) { return; }
              var q = a.search ? a.search.slice(1) + '&' : '';
              (new w.Image(1, 1)).src = O + a.pathname + '?' + q + 'dtdc=' +
                encodeURIComponent(w.btoa(unescape(encodeURIComponent(b)))) + '&_synr=1';
            } catch (x) { /* rescue is best-effort */ }
          };

          if (w.fetch) {
            var origFetch = w.fetch;
            w.fetch = function (i2, o2) {
              var p = origFetch.apply(w, arguments);
              try {
                var u = (typeof i2 === 'string' || (w.URL && i2 instanceof w.URL)) ? String(i2) : (i2 && i2.url) || '';
                var m = String((o2 && o2.method) || (i2 && typeof i2 === 'object' && i2.method) || 'GET').toUpperCase();
                if ('POST' === m && u) {
                  var a3 = dc(u);
                  var b3 = o2 && typeof o2.body === 'string' ? o2.body : null;
                  if (a3 && b3 && p && typeof p.catch === 'function') { p.catch(function () { R(a3, b3); }); }
                }
              } catch (x) { /* observation must not affect the call */ }
              return p;
            };
          }

          var nav0 = w.navigator;
          if (nav0 && nav0.sendBeacon) {
            var sb0 = nav0.sendBeacon.bind(nav0);
            nav0.sendBeacon = function (u, dd) {
              var okB = sb0.apply(nav0, arguments);
              try {
                if (!okB) {
                  var a4 = dc(String(u));
                  if (a4 && typeof dd === 'string' && dd) { R(a4, dd); }
                }
              } catch (x) { /* observation must not affect the call */ }
              return okB;
            };
          }

          var XR = w.XMLHttpRequest;
          if (XR && XR.prototype && XR.prototype.open && XR.prototype.send) {
            var xo = XR.prototype.open;
            var xs = XR.prototype.send;
            XR.prototype.open = function (m, u) {
              try { this.__synDR = 'POST' === String(m || '').toUpperCase() ? dc(String(u)) : null; }
              catch (x) { this.__synDR = null; }
              return xo.apply(this, arguments);
            };
            XR.prototype.send = function (b) {
              try {
                var a5 = this.__synDR;
                if (a5 && typeof b === 'string' && b) {
                  var fired = 0;
                  var g5 = function () { if (!fired) { fired = 1; R(a5, b); } };
                  this.addEventListener('error', g5);
                  this.addEventListener('timeout', g5);
                }
              } catch (x) { /* observation must not affect the call */ }
              return xs.apply(this, arguments);
            };
          }
        }
      } catch (x) { /* rescue never breaks the page */ }
    }

    /* ----------------------------------------------------------------
     * 5. GA4 measurement recovery watchdog
     *
     * Some browser privacy modes (most notably iOS Safari Private Browsing)
     * let the container run but silently prevent its Google tag from ever
     * dispatching a /g/collect hit, while plain first-party fetches keep
     * working. If the container has loaded and the Google tag is still silent
     * after the grace period, the visit is recovered through the existing
     * server container pipeline: a minimal page_view first, then every
     * data-layer event the plugin pushed, ecommerce translated to the GA4
     * protocol. Every hit carries "synapse_recovered" so recovered traffic
     * stays identifiable in GA4 and in the logs.
     *
     * The "has the Google tag spoken" observation is NOT made here - it is
     * made by the inline sentinel, which is installed before this file even
     * starts loading and writes window.__synSeen. That split is what makes it
     * safe to move the watchdog out of the inline block: if this file arrives
     * late (say after the boot timeout already started the container), the
     * sentinel has been watching the whole time, so a hit that already went
     * out is still counted and no duplicate recovery is produced.
     *
     * In normal browsers the Google tag sends within a couple of seconds, the
     * sentinel records it, and this does nothing - zero behaviour change. If
     * the container never loads (blocked, or consent-gated and never granted)
     * the watchdog never arms, so no unconsented hit is ever produced.
     * ---------------------------------------------------------------- */
    /* The ids arrive base64-encoded so the page source carries no readable
     * Google id. Both forms are accepted, on purpose and permanently: the
     * discriminator is "-", which every Google id contains (G-, GTM-, AW-,
     * DC-, UA-) and which standard base64 can never produce. So a plain value
     * is passed through untouched and an encoded one is decoded, with no
     * version flag anywhere. That is what makes every combination of plugin
     * version and cached copy of this file safe: an old plugin emitting plain
     * ids works against this file, and this file's predecessor - which reads
     * the value literally - only ever meets plain ids, because the ?v= token
     * is a content hash, so a page that carries encoded ids can only have
     * asked for the build that decodes them.
     *
     * A decode failure returns "" rather than the raw value: an undecodable
     * id would make the container lookup below miss anyway, and "" is the
     * established "feature off" signal, so the watchdog simply never arms
     * instead of arming against a wrong key. */
    var decId = function (v) {
      if (typeof v !== 'string' || '' === v) { return ''; }
      if (-1 !== v.indexOf('-')) { return v; }
      try { return w.atob(v); } catch (x) { return ''; }
    };

    var T = decId(CFG.t);
    var C = decId(CFG.c);
    var SUF = typeof CFG.s === 'string' ? CFG.s : '';

    if (T && C && P && O) {
      try {
        if (!w.__synGa4Fb) {
          w.__synGa4Fb = 1;

          var G = 8000;
          var sent = false, armT = 0, hn = 0, di = 0, hooked = false, ses = null, con = null, stopped = false;
          var nav = w.navigator, doc = w.document, eu = encodeURIComponent;
          var WL = {
            view_item: 1, view_item_list: 1, select_item: 1, add_to_cart: 1,
            remove_from_cart: 1, view_cart: 1, begin_checkout: 1, add_payment_info: 1,
            add_shipping_info: 1, purchase: 1, refund: 1, search: 1, login: 1, sign_up: 1
          };

          /* Captured after the shim (and the rescue) installed, so the recovery
           * hit is encoded exactly like every other container hit. */
          var IF = w.fetch ? w.fetch.bind(w) : null;

          /* Did the Google tag for OUR property speak? __synSeenT is the
           * sentinel's per-property map, with "*" for a hit that carried no id
           * in the query (GA4 may post its parameters in the body). Falling
           * back to the coarse __synSeen flag keeps a page working against a
           * sender cached from a release whose sentinel only had that. */
          var heard = function () {
            try {
              var m = w.__synSeenT;
              if (m) { return !!(m[T] || m['*']); }
            } catch (x) { /* fall through to the coarse flag */ }
            return !!w.__synSeen;
          };

          var consent = function () {
            var got = false, ad = false, an = false;
            try {
              var dl = w.dataLayer || [];
              for (var i6 = 0; i6 < dl.length; i6++) {
                var e6 = dl[i6];
                if (e6 && 'consent' === e6[0] && ('default' === e6[1] || 'update' === e6[1]) && e6[2] && 'object' === typeof e6[2]) {
                  got = true;
                  if (void 0 !== e6[2].ad_storage) { ad = 'granted' === e6[2].ad_storage; }
                  if (void 0 !== e6[2].analytics_storage) { an = 'granted' === e6[2].analytics_storage; }
                }
              }
            } catch (x) { /* absent consent data means unmanaged consent */ }

            /* A CMP wired through GTM's own consent templates calls
             * setDefaultConsentState / updateConsentState, which never appear
             * in the dataLayer as consent entries at all. GTM resolves them
             * into google_tag_data.ics, and that is the authoritative state,
             * so it wins over anything read above. Without this a visitor who
             * declined through such a CMP was treated as unmanaged and every
             * recovered hit went out as gcs=G111.
             *
             * 1 is granted, 2 is denied, absent means that particular signal
             * was never set - so each one is only taken when it is known. */
            try {
              /* The entries table, not getConsentState(). On a live container
               * that function takes a container context as its second
               * argument and throws without one, so the call never returned
               * anything on a real site and this whole branch was dead. An
               * entry carries update (the CMP's answer) over default (the
               * initial state); either may be absent. */
              var ics = w.google_tag_data && w.google_tag_data.ics;
              var en7 = ics && ics.entries;
              var pick = function (k) {
                var e7 = en7 && en7[k];
                if (!e7) { return void 0; }
                if (void 0 !== e7.update) { return !!e7.update; }
                if (void 0 !== e7['default']) { return !!e7['default']; }
                return void 0;
              };
              var a7 = pick('ad_storage'), n7 = pick('analytics_storage');
              if (void 0 !== a7) { got = true; ad = a7; }
              if (void 0 !== n7) { got = true; an = n7; }
            } catch (x) { /* GTM internals are best-effort */ }

            if (!got) { ad = true; an = true; }
            return { ad: ad, an: an };
          };

          /* Identity, deliberately in two parts.
           *
           * The persisted one lives in sessionStorage and is only ever touched
           * while analytics storage is granted. The ephemeral one is minted
           * once per page load and is what a visitor who refused, or whose
           * browser refuses storage, is measured with.
           *
           * Keeping them apart is the point. There used to be a single state()
           * that was re-run whenever the current identity was not persisted, so
           * that a denied -> granted visitor would move onto the stored id.
           * When storage is unavailable that condition never clears, so every
           * hit minted a fresh client id and one visitor arrived as several -
           * in exactly the browsers recovery exists to serve. */
          var mkid = function (now) { return Math.floor(9e8 * Math.random() + 1e8) + '.' + now; };

          /* GA4's own client id, if the real tag has already set _ga on this
           * domain. Adopting it puts a recovered hit on the same user as the
           * hits that got through, instead of inventing a parallel one that
           * splits the same person in two.
           *
           * Only read when a NEW identity is being minted: switching away from
           * an id that has already sent hits this session would recreate the
           * split it is meant to prevent. A cookie read is storage access, and
           * persisted() is the only caller - it is reached only when analytics
           * storage is granted. */
          var gaCid = function () {
            try {
              var m9 = /(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/.exec((doc && doc.cookie) || '');
              return m9 ? m9[1] : null;
            } catch (x) { return null; }
          };

          /* Two separate questions, which used to share one answer:
           *   fresh - recovery has no record of this browser session,
           *   first - Analytics has never seen this visitor at all.
           * The absence of our own record only answers the first of them. A
           * _ga cookie is proof the Google tag already counted this person,
           * so claiming a first visit on top of their existing client id
           * would inflate new users for no reason. */
          /* Two ephemeral identities, not one, and never the same object.
           *
           * ephD is what a denied visitor is measured with: random, minted
           * once per page, and it never sees a cookie or storage - a denied
           * hit must be a genuine cookieless ping. ephG is for a granted
           * visitor whose browser gives us no working storage: also minted
           * once, and it may adopt the _ga client id because consent allows
           * the read. One shared object used to serve both, so an id taken
           * from the cookie under consent was still being sent after that
           * consent was withdrawn. Each is decided once and never revised,
           * so within either consent state the id is stable for the page. */
          var ephD = null, ephG = null;
          var ephemeral = function (an) {
            var n;
            if (!an) {
              if (!ephD) {
                n = Math.floor(Date.now() / 1e3);
                ephD = { cid: mkid(n), sid: n, first: true, fresh: true };
              }
              return ephD;
            }
            if (!ephG) {
              n = Math.floor(Date.now() / 1e3);
              var ga = gaCid();
              ephG = { cid: ga || mkid(n), sid: n, first: !ga, fresh: true };
            }
            return ephG;
          };

          /* Null means the identity could not be kept, which is not the same as
           * sessionStorage being absent: a storage object can exist, accept a
           * write and keep nothing. The round trip is proven rather than
           * assumed, and a null sends the caller to the ephemeral identity -
           * stable for the page - instead of to a new id on every hit. */
          var persisted = function () {
            var s = null;
            try { s = w.sessionStorage; } catch (x) { return null; }
            if (!s) { return null; }
            var now = Math.floor(Date.now() / 1e3), st = null;
            try { st = JSON.parse(s.getItem('_synfb') || 'null'); } catch (x) { st = null; }
            var first = !st || !st.cid;
            var fresh = first;
            if (first) {
              var ga = gaCid();
              st = { cid: ga || mkid(now), sid: now };
              /* Still a new recovery session, but not a new visitor. */
              if (ga) { first = false; }
            }
            try {
              s.setItem('_synfb', JSON.stringify(st));
              if (!s.getItem('_synfb')) { return null; }
            } catch (x) { return null; }
            return { cid: st.cid, sid: st.sid, first: first, fresh: fresh };
          };

          /* The stored identity is attempted exactly once per page. Retrying
           * on every hit while it fails would let storage that starts working
           * mid-page move the visitor onto a new id after hits have already
           * gone out under the ephemeral one - the same split, from the other
           * direction. */
          var pers = null, persTried = false;
          var state = function (an) {
            if (!an) { return ephemeral(false); }
            if (!persTried) { persTried = true; pers = persisted(); }
            return pers || ephemeral(true);
          };

          var itstr = function (a) {
            var M = {
              item_id: 'id', item_name: 'nm', item_brand: 'br', item_variant: 'va',
              item_category: 'ca', item_category2: 'c2', item_category3: 'c3',
              item_category4: 'c4', item_category5: 'c5', price: 'pr', quantity: 'qt',
              coupon: 'cp', discount: 'ds', index: 'lp', item_list_id: 'li',
              item_list_name: 'ln', affiliation: 'af'
            };
            var out = [], i7, k7, it, p7, v7;
            for (i7 = 0; i7 < a.length && i7 < 60; i7++) {
              it = a[i7] || {}; p7 = [];
              for (k7 in M) {
                v7 = it[k7];
                if (v7 === void 0 || v7 === null || v7 === '') { continue; }
                v7 = String(v7).replace(/~/g, ' ');
                if (v7.length > 100) { v7 = v7.slice(0, 100); }
                p7.push(M[k7] + v7);
              }
              if (p7.length) { out.push('pr' + (i7 + 1) + '=' + eu(p7.join('~'))); }
            }
            return out;
          };

          var ecom = function (ec) {
            var ex = [];
            try {
              if (!ec || 'object' !== typeof ec) { return ex; }
              if (ec.currency) { ex.push('cu=' + eu(ec.currency)); }
              if (ec.value !== void 0 && ec.value !== null && ec.value !== '') { ex.push('epn.value=' + eu(ec.value)); }
              if (ec.transaction_id) { ex.push('ep.transaction_id=' + eu(ec.transaction_id)); }
              if (ec.tax) { ex.push('epn.tax=' + eu(ec.tax)); }
              if (ec.shipping) { ex.push('epn.shipping=' + eu(ec.shipping)); }
              if (ec.coupon) { ex.push('ep.coupon=' + eu(ec.coupon)); }
              if (ec.items && ec.items.length) { ex = ex.concat(itstr(ec.items)); }
            } catch (x) { /* malformed ecommerce object */ }
            return ex;
          };

          var send2 = function (en, extra) {
            if (!IF || stopped) { return; }
            try {
              /* Consent is read per hit, not captured once at fire(). A visitor
               * who answers the banner after the watchdog armed would otherwise
               * have every later hit - including purchase - labelled with the
               * state as it was at second eight, for the whole page. */
              con = consent();
              /* Identity follows the consent that was just read. Granted moves
               * onto the stored id so the session stitches together; withdrawn
               * drops back to the ephemeral one, so a denied hit is a genuine
               * cookieless ping and not the stored identity wearing gcs=G100. */
              ses = state(con.an);
              hn++;
              var q = [
                'v=2', 'tid=' + eu(T), 'cid=' + eu(ses.cid), 'sid=' + ses.sid, 'sct=1',
                'seg=' + (ses.fresh && 1 === hn ? '0' : '1'),
                '_p=' + Math.floor(9e8 * Math.random() + 1e8), '_s=' + hn,
                'gcs=G1' + (con.ad ? '1' : '0') + (con.an ? '1' : '0'),
                'npa=' + (con.ad ? '0' : '1'),
                'ul=' + eu(((nav && nav.language) || '').toLowerCase()),
                'sr=' + (w.screen ? w.screen.width + 'x' + w.screen.height : ''),
                'dl=' + eu(w.location.href),
                'dt=' + eu((doc && doc.title) || ''),
                'en=' + eu(en),
                'ep.synapse_recovered=1'
              ];
              if (doc && doc.referrer) { q.push('dr=' + eu(doc.referrer)); }
              if (ses.fresh && 1 === hn) { q.push('_ss=1', '_nsi=1'); }
              if (ses.first && 1 === hn) { q.push('_fv=1'); }
              if (extra && extra.length) { q = q.concat(extra); }
              /* Our own hit travels through the sentinel, which would set the
               * "the Google tag spoke" flag and make the watchdog disarm itself
               * on its very first send. The sentinel writes that flag
               * synchronously inside its fetch wrapper, so restoring it right
               * after the call is exact rather than racy. */
              var preS = w.__synSeen;
              var preT = w.__synSeenT && w.__synSeenT[T];
              IF(O + P + '/g/collect?' + q.join('&'), { method: 'GET', keepalive: true }).catch(function () { });
              try {
                if (!preS) { w.__synSeen = preS; }
                if (w.__synSeenT && !preT) { delete w.__synSeenT[T]; }
              } catch (xr) { /* frozen window */ }
            } catch (x) { /* recovery is best-effort */ }
          };

          var evName = function (nm) {
            if ('string' !== typeof nm || !nm) { return null; }
            if (SUF) {
              if (nm.length > SUF.length && nm.slice(-SUF.length) === SUF) { return nm.slice(0, nm.length - SUF.length); }
              return null;
            }
            return WL[nm] ? nm : null;
          };

          var pump = function () {
            try {
              /* A Google tag that wakes up late takes over from here. Without
               * this the push hook installed by fire() stays live for the rest
               * of the page and every further event is sent twice: once by the
               * real tag and once as a recovered duplicate. */
              if (heard()) { stopped = true; }
              if (stopped) { di = (w.dataLayer || []).length; return; }
              var dl = w.dataLayer || [];
              for (; di < dl.length; di++) {
                var e8 = dl[di];
                if (!e8 || 'object' !== typeof e8 || Array.isArray(e8)) { continue; }
                var en = evName(e8.event);
                if (!en || 'page_view' === en) { continue; }
                send2(en, ecom(e8.ecommerce));
              }
            } catch (x) { /* replay is best-effort */ }
          };

          var fire = function () {
            if (heard() || sent) { return; }
            sent = true;
            try {
              con = consent();
              /* ses is not set here: send2 picks the identity from the consent
               * it reads per hit, so there is one place that decides it. */
              send2('page_view');
              pump();
              if (!hooked) {
                hooked = true;
                var dl = w.dataLayer = w.dataLayer || [];
                var dp = dl.push;
                dl.push = function () {
                  var r = dp.apply(dl, arguments);
                  try { pump(); } catch (x) { /* replay is best-effort */ }
                  return r;
                };
              }
            } catch (x) { /* recovery never breaks the page */ }
          };

          var polls = 0;
          var pt = w.setInterval(function () {
            try {
              if (heard() || sent) { w.clearInterval(pt); return; }
              if (w.google_tag_manager && w.google_tag_manager[C]) {
                w.clearInterval(pt);
                armT = Date.now();
                w.setTimeout(fire, G);
                return;
              }
              if (++polls > 240) { w.clearInterval(pt); }
            } catch (x) { w.clearInterval(pt); }
          }, 500);

          if (w.addEventListener) {
            w.addEventListener('pagehide', function () {
              try { if (!heard() && !sent && armT && Date.now() - armT > 2500) { fire(); } }
              catch (x) { /* unload path is best-effort */ }
            });
          }
        }
      } catch (x) { /* watchdog never breaks the page */ }
    }

    /* Set last: the boot reads this to know the tail actually ran end-to-end.
     * A worker still serving a core-only s.js leaves it unset, and the boot
     * then pulls assets/tail.js from the origin - so plugin and worker can be
     * deployed in either order without a broken window. */
    w.__synTail = 1;
  } catch (x) { /* nothing in this file may ever surface as a page error */ }
})(window, document);
