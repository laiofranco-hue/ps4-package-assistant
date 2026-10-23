#include "platform.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdbool.h>
#include <orbis/libkernel.h>
#include <orbis/Sysmodule.h>
#include <orbis/UserService.h>
#include <orbis/Pad.h>
/* Internal installer modules must not become startup PRX dependencies. */
#include <orbis/VideoOut.h>
#include <orbis/Net.h>
#include <orbis/NetCtl.h>

typedef struct {void *heap;size_t size;} BgftInit;
typedef struct {
    int32_t user,entitlement;
    const char *cid,*url,*extra,*title,*icon,*sku;
    uint32_t option;
    const char *scenario,*release,*type,*subtype;
    uint64_t size;
} BgftDownload;
_Static_assert(sizeof(BgftDownload)==104,"BGFT download ABI");
static int (*sceBgftServiceIntInit)(BgftInit *);
static int (*sceBgftServiceIntDownloadRegisterTask)(BgftDownload *,int *);
static int (*sceBgftServiceDownloadStartTask)(int);
static int (*stop_task)(int);
static int (*sceBgftServiceDownloadGetProgress)(int,Progress *);

static int (*sceAppInstUtilInitialize)(void);
static int (*sceAppInstUtilAppExists)(const char *,int *);
static int installer_modules(char *error,size_t size){
    struct {const char *path;const char *symbol;void **target;} imports[]={
        {"libSceAppInstUtil.sprx","sceAppInstUtilInitialize",(void**)&sceAppInstUtilInitialize},
        {"libSceAppInstUtil.sprx","sceAppInstUtilAppExists",(void**)&sceAppInstUtilAppExists},
        {"libSceBgft.sprx","sceBgftServiceIntInit",(void**)&sceBgftServiceIntInit},
        {"libSceBgft.sprx","sceBgftServiceIntDownloadRegisterTask",(void**)&sceBgftServiceIntDownloadRegisterTask},
        {"libSceBgft.sprx","sceBgftServiceDownloadStartTask",(void**)&sceBgftServiceDownloadStartTask},
        {"libSceBgft.sprx","sceBgftServiceDownloadGetProgress",(void**)&sceBgftServiceDownloadGetProgress}
    };
    const char *sandbox=sceKernelGetFsSandboxRandomWord();
    if(!sandbox||!*sandbox){snprintf(error,size,"SANDBOX INDISPONIVEL");return -1;}
    int handle=-1;const char *last=NULL;
    for(size_t i=0;i<sizeof(imports)/sizeof(imports[0]);i++){
        if(!last||strcmp(last,imports[i].path)){
            char module_path[256];
            int length=snprintf(module_path,sizeof(module_path),"/%s/common/lib/%s",sandbox,imports[i].path);
            if(length<0||(size_t)length>=sizeof(module_path)){snprintf(error,size,"CAMINHO DE MODULO INVALIDO");return -1;}
            platform_trace(imports[i].path,0);
            handle=(int)sceKernelLoadStartModule(module_path,0,NULL,0,NULL,NULL);
            if(handle<0){snprintf(error,size,"MODULO %08X",(unsigned)handle);return handle;}
            last=imports[i].path;
        }
        int code=sceKernelDlsym(handle,imports[i].symbol,imports[i].target);
        if(code||!*imports[i].target){snprintf(error,size,"SIMBOLO %08X",(unsigned)code);return code?code:-1;}
    }
    sceKernelDlsym(handle,"sceBgftServiceDownloadStopTask",(void**)&stop_task);
    return 0;
}

void platform_trace(const char *stage,int code){
    char line[384];snprintf(line,sizeof(line),"[PKGA 0.18] %s code=%08X\n",stage,(unsigned)code);
    sceKernelDebugOutText(0,line);
}
int platform_init(char ip[16],char *error,size_t size){
    enum OrbisSysModuleInternal modules[]={ORBIS_SYSMODULE_INTERNAL_SYSCORE,ORBIS_SYSMODULE_INTERNAL_SYSTEM_SERVICE,ORBIS_SYSMODULE_INTERNAL_USER_SERVICE,ORBIS_SYSMODULE_INTERNAL_NET,ORBIS_SYSMODULE_INTERNAL_NETCTL,ORBIS_SYSMODULE_INTERNAL_APP_INST_UTIL,ORBIS_SYSMODULE_INTERNAL_BGFT};
    snprintf(ip,16,"0.0.0.0");
    for(size_t i=0;i<sizeof(modules)/sizeof(modules[0]);i++){
        platform_trace("load module",(int)modules[i]);
        int code=(int)sceSysmoduleLoadModuleInternal(modules[i]);
        platform_trace("module returned",code);
        /* Some modules are already loaded by startup. Initialization below is authoritative. */
        (void)code;
    }
    platform_trace("net init",0);sceNetInit();sceNetCtlInit();OrbisNetCtlInfo info={0};
    int code=sceNetCtlGetInfo(ORBIS_NET_CTL_INFO_IP_ADDRESS,&info);
    if(code){snprintf(error,size,"REDE/IP %08X",(unsigned)code);return code;}
    snprintf(ip,16,"%s",info.ip_address);
    sceUserServiceInitialize(NULL);
    platform_trace("resolve installer modules",0);
    code=installer_modules(error,size);if(code)return code;
    platform_trace("appinst init",0);
    code=sceAppInstUtilInitialize();
    if(code){snprintf(error,size,"APPINST INIT %08X",(unsigned)code);return code;}
    BgftInit init={calloc(1,1024*1024),1024*1024};
    if(!init.heap){snprintf(error,size,"SEM MEMORIA PARA BGFT");return -1;}
    platform_trace("bgft init",0);
    code=sceBgftServiceIntInit(&init);if(code){snprintf(error,size,"BGFT INIT %08X",(unsigned)code);return code;}
    return 0;
}
int platform_install(const char *cid,const char *url,const char *title,uint64_t size,int *task){
    int user=0,code=sceUserServiceGetForegroundUser(&user);if(code)return code;
    BgftDownload params={0};params.user=user;params.entitlement=5;params.cid=cid;params.url=url;
    params.title=title;params.icon="";params.scenario="0";params.type="PS4GD";params.subtype="";params.option=0x10000;params.size=size;
    code=sceBgftServiceIntDownloadRegisterTask(&params,task);if(code)return code;
    return sceBgftServiceDownloadStartTask(*task);
}
static int pad=-1;
static uint32_t previous_buttons;
static int (*read_pad)(int,OrbisPadData *);
int platform_controls_init(void){
    sceSysmoduleLoadModuleInternal(ORBIS_SYSMODULE_INTERNAL_PAD);
    const char *sandbox=sceKernelGetFsSandboxRandomWord();if(!sandbox)return 0;
    char path[256];snprintf(path,sizeof(path),"/%s/common/lib/libScePad.sprx",sandbox);
    int handle=(int)sceKernelLoadStartModule(path,0,NULL,0,NULL,NULL);if(handle<0)return 0;
    int (*init)(void)=NULL;int (*open_pad)(int,int,int,void *)=NULL;
    if(sceKernelDlsym(handle,"scePadInit",(void**)&init)||!init ||
       sceKernelDlsym(handle,"scePadOpen",(void**)&open_pad)||!open_pad ||
       sceKernelDlsym(handle,"scePadReadState",(void**)&read_pad)||!read_pad)return 0;
    init();int user=0;if(sceUserServiceGetForegroundUser(&user))return 0;
    pad=open_pad(user,0,0,NULL);return pad>=0;
}
int platform_cancel_pressed(void){
    if(pad<0||!read_pad)return 0;
    OrbisPadData data={0};if(read_pad(pad,&data)||!data.connected){previous_buttons=0;return 0;}
    uint32_t pressed=data.buttons & ~previous_buttons;previous_buttons=data.buttons;
    return (pressed & ORBIS_PAD_BUTTON_CIRCLE)!=0;
}
int platform_cancel(int task){return stop_task?stop_task(task):-1;}
int platform_progress(int task,Progress *p){memset(p,0,sizeof(*p));return sceBgftServiceDownloadGetProgress(task,p);}
int platform_exists(const char *title,int *exists){return sceAppInstUtilAppExists(title,exists);}
double platform_time(void){return (double)sceKernelGetProcessTime()/1000000.0;}
void platform_sleep(unsigned ms){sceKernelUsleep(ms*1000);}
int net_listen(int port){
    int fd=sceNetSocket("PS4 Assistant",2,1,0);if(fd<0)return fd;
    int reuse=1;sceNetSetsockopt(fd,0xffff,4,&reuse,sizeof(reuse));
    struct {uint8_t len,family;uint16_t port;uint32_t address;uint8_t zero[8];} address={0};
    address.len=16;address.family=2;address.port=sceNetHtons((uint16_t)port);
    int code=sceNetBind(fd,(OrbisNetSockaddr*)&address,16);if(code<0){sceNetSocketClose(fd);return code;}
    code=sceNetListen(fd,8);if(code<0){sceNetSocketClose(fd);return code;}
    int on=1;sceNetSetsockopt(fd,0xffff,0x1200,&on,sizeof(on));return fd;
}
int net_accept_ready(int fd){
    int result=sceNetAccept(fd,NULL,NULL);if(result>=0){int off=0,timeout=3000000;sceNetSetsockopt(result,0xffff,0x1200,&off,sizeof(off));sceNetSetsockopt(result,0xffff,0x1006,&timeout,sizeof(timeout));sceNetSetsockopt(result,0xffff,0x1005,&timeout,sizeof(timeout));}return result;
}
int net_read(int fd,void *data,size_t size){return sceNetRecv(fd,data,size,0);}
int net_write(int fd,const void *data,size_t size){size_t offset=0;while(offset<size){int n=sceNetSend(fd,(const char*)data+offset,size-offset,0);if(n<=0)return -1;offset+=(size_t)n;}return (int)offset;}
void net_close(int fd){sceNetSocketClose(fd);}
static int video,active;static int64_t frame;static void *buffers[2];
int screen_open(uint32_t **pixels,int w,int h){
    platform_trace("video module load",0);
    int video_module=(int)sceSysmoduleLoadModuleInternal(ORBIS_SYSMODULE_INTERNAL_VIDEO_OUT);
    platform_trace("video module returned",video_module);
    if(video_module)return video_module;
    video=sceVideoOutOpen(ORBIS_VIDEO_USER_MAIN,ORBIS_VIDEO_OUT_BUS_MAIN,0,NULL);if(video<0)return video;
    off_t offset;size_t bytes=16*1024*1024;void *memory=NULL;
    int code=sceKernelAllocateDirectMemory(0,sceKernelGetDirectMemorySize(),bytes,0x200000,3,&offset);if(code)return code;
    code=sceKernelMapDirectMemory(&memory,bytes,0x33,0,offset,0x200000);if(code)return code;
    buffers[0]=memory;buffers[1]=(char*)memory+(size_t)w*h*4;
    OrbisVideoOutBufferAttribute attr;sceVideoOutSetBufferAttribute(&attr,0x80000000,1,0,w,h,w);
    code=sceVideoOutRegisterBuffers(video,0,buffers,2,&attr);if(code)return code;
    sceVideoOutSetFlipRate(video,0);active=0;frame=1;*pixels=buffers[active];return 0;
}
void screen_flip(uint32_t **pixels){
    int code=sceVideoOutSubmitFlip(video,active,ORBIS_VIDEO_OUT_FLIP_VSYNC,frame);
    if(!code){
        OrbisVideoOutFlipStatus status;
        for(int i=0;i<200;i++){if(!sceVideoOutGetFlipStatus(video,&status)&&status.flipArg==frame)break;sceKernelUsleep(1000);}
        frame++;active=1-active;*pixels=buffers[active];
    }
}
