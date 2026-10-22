#include "platform.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <sys/time.h>
#include <fcntl.h>
#include <time.h>
static uint64_t sizes[100];static double started[100];static int next=1;
int platform_init(char ip[16],char *error,size_t size){snprintf(ip,16,"127.0.0.1");snprintf(error,size,"HOST SIMULATOR");return 0;}
int platform_install(const char *cid,const char *url,const char *title,uint64_t size,int *task){
    (void)url;(void)title;if(next>=100)return -1;
    if(strstr(cid,"FAIL"))return (int)0x80990015;
    *task=next++;sizes[*task]=size;started[*task]=platform_time();return strstr(cid,"STRT")?(int)0x80990016:0;
}
int platform_progress(int id,Progress *p){
    if(id<=0||id>=next)return -1;
    memset(p,0,sizeof(*p));p->total=sizes[id];double elapsed=platform_time()-started[id];
    p->downloaded=(uint64_t)(elapsed*10000000.0);if(p->downloaded>p->total)p->downloaded=p->total;
    p->seconds=(uint32_t)((p->total-p->downloaded)/10000000)+ (p->downloaded<p->total?1:0);
    p->preparing=100;p->copying=p->downloaded==p->total?100:0;return 0;
}
int platform_exists(const char *title,int *exists){(void)title;*exists=0;return 0;}
double platform_time(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec/1e9;}
void platform_sleep(unsigned ms){usleep(ms*1000);}
int net_listen(int port){
    int fd=socket(AF_INET,SOCK_STREAM,0),on=1;setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&on,sizeof(on));
    struct sockaddr_in addr={0};addr.sin_family=AF_INET;addr.sin_addr.s_addr=htonl(INADDR_LOOPBACK);addr.sin_port=htons((uint16_t)port);
    if(bind(fd,(struct sockaddr*)&addr,sizeof(addr))||listen(fd,8)){close(fd);return -1;}
    fcntl(fd,F_SETFL,O_NONBLOCK);return fd;
}
int net_accept_ready(int fd){
    int result=accept(fd,NULL,NULL);if(result>=0){
        fcntl(result,F_SETFL,fcntl(result,F_GETFL,0)&~O_NONBLOCK);
        struct timeval t={3,0};setsockopt(result,SOL_SOCKET,SO_RCVTIMEO,&t,sizeof(t));setsockopt(result,SOL_SOCKET,SO_SNDTIMEO,&t,sizeof(t));
        int on=1;setsockopt(result,SOL_SOCKET,SO_NOSIGPIPE,&on,sizeof(on));
    }return result;
}
int net_read(int fd,void *data,size_t size){return (int)recv(fd,data,size,0);}
int net_write(int fd,const void *data,size_t size){size_t offset=0;while(offset<size){int n=(int)send(fd,(const char*)data+offset,size-offset,0);if(n<=0)return -1;offset+=(size_t)n;}return (int)offset;}
void net_close(int fd){close(fd);}
static uint32_t *memory;static int sw,sh;
int screen_open(uint32_t **pixels,int w,int h){memory=calloc((size_t)w*h,4);*pixels=memory;sw=w;sh=h;return memory?0:-1;}
void screen_flip(uint32_t **pixels){
    (void)pixels;const char *path=getenv("RECEIVER_FRAME");if(!path)return;
    char temp[4096];if(snprintf(temp,sizeof(temp),"%s.tmp",path)>=(int)sizeof(temp))return;
    FILE *f=fopen(temp,"wb");if(!f)return;
    fprintf(f,"P6\n%d %d\n255\n",sw,sh);
    for(int i=0;i<sw*sh;i++){unsigned char rgb[3]={(memory[i]>>16)&255,(memory[i]>>8)&255,memory[i]&255};fwrite(rgb,1,3,f);}fclose(f);rename(temp,path);
}
