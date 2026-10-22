#include "model.h"
#include "protocol.h"
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

static Model model;
static pthread_mutex_t guard=PTHREAD_MUTEX_INITIALIZER;
static int port=12800;
static void response(int fd,int status,const char *text){
    char header[256];int size=snprintf(header,sizeof(header),"HTTP/1.1 %d Reply\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n",status,strlen(text));
    net_write(fd,header,(size_t)size);net_write(fd,text,strlen(text));
}
static void request(int fd){
    char data[20481];size_t used=0;char *body=NULL;long length=-1;
    while(used<sizeof(data)-1){
        int got=net_read(fd,data+used,sizeof(data)-1-used);if(got<=0)return;used+=(size_t)got;data[used]=0;
        body=strstr(data,"\r\n\r\n");if(body)break;
        if(used>=4096){response(fd,431,"{\"error\":\"Cabecalho muito grande\"}");return;}
    }
    if(!body)return;
    if(body-data>4096){response(fd,431,"{}");return;}
    char method[12],route[128];if(sscanf(data,"%11s %127s",method,route)!=2||strcmp(method,"POST")){
        response(fd,405,"{\"error\":\"Use POST JSON\"}");return;
    }
    *body=0;int json=0,origin=0,chunked=0;
    char *line=strstr(data,"\r\n");
    while(line){line+=2;char *next=strstr(line,"\r\n");if(next)*next=0;
        if(!strncasecmp(line,"Content-Length:",15)){
            char *end;long value=strtol(line+15,&end,10);while(*end==' ')end++;
            if(length!=-1||*end||value<0||value>16384){response(fd,400,"{\"error\":\"Tamanho invalido\"}");return;}length=value;
        }
        if(!strncasecmp(line,"Content-Type:",13)&&strstr(line+13,"application/json"))json=1;
        if(!strncasecmp(line,"Origin:",7))origin=1;
        if(!strncasecmp(line,"Transfer-Encoding:",18))chunked=1;
        line=next;
    }
    body+=4;
    if(!json||length<0||origin||chunked){response(fd,400,"{\"error\":\"Requer JSON local com Content-Length\"}");return;}
    size_t offset=(size_t)(body-data);
    if(offset+(size_t)length>=sizeof(data)){response(fd,413,"{}");return;}
    while(used<offset+(size_t)length){int got=net_read(fd,data+used,offset+(size_t)length-used);if(got<=0)return;used+=(size_t)got;}
    body[length]=0;
    if(memchr(body,0,(size_t)length)){response(fd,400,"{}");return;}
    int status;Model next;
    pthread_mutex_lock(&guard);next=model;pthread_mutex_unlock(&guard);
    char *output=command(&next,route,body,&status);
    pthread_mutex_lock(&guard);model=next;pthread_mutex_unlock(&guard);
    if(output){response(fd,status,output);free(output);}else response(fd,500,"{}");
}
static void *serve(void *unused){
    (void)unused;int server=net_listen(port);
    if(server<0){pthread_mutex_lock(&guard);snprintf(model.message,sizeof(model.message),"PORTA OCUPADA. FECHE O INSTALADOR ANTERIOR E REABRA.");model.ready=0;pthread_mutex_unlock(&guard);return NULL;}
    double previous=0;
    for(;;){
        int fd=net_accept_ready(server);if(fd>=0){request(fd);net_close(fd);}
        double now=platform_time();
        if(now-previous>=1){
            Model next;pthread_mutex_lock(&guard);next=model;pthread_mutex_unlock(&guard);
            for(int i=0;i<next.count;i++)if(!next.jobs[i].complete && !next.jobs[i].progress.error){
                Progress progress={0};int result=platform_progress(next.jobs[i].task,&progress);
                if(result){next.jobs[i].query_error=result;next.jobs[i].speed=0;}
                else sample(&next.jobs[i],&progress,now);
            }
            pthread_mutex_lock(&guard);model=next;pthread_mutex_unlock(&guard);previous=now;
        }
        platform_sleep(50);
    }
}
int main(int argc,char **argv){
    setvbuf(stdout,NULL,_IONBF,0);
#ifndef __ORBIS__
    if(argc>1)port=atoi(argv[1]);
#else
    (void)argc;(void)argv;
#endif
    model.ready=platform_init(model.ip,model.message,sizeof(model.message))==0;
    if(model.ready)snprintf(model.message,sizeof(model.message),"PRONTO PARA RECEBER. FILA CONTROLADA PELO MAC.");
#ifndef __ORBIS__
    snprintf(model.message,sizeof(model.message),"SIMULADOR NO MAC - NENHUM PKG E INSTALADO NESTE MODO.");
#endif
    uint32_t *pixels=NULL;
    if(screen_open(&pixels,1280,720)){fprintf(stderr,"Video initialization failed\n");return 1;}
    pthread_t thread;if(pthread_create(&thread,NULL,serve,NULL))return 1;
    printf("Receiver listening on %d; ready=%d\n",port,model.ready);
    for(;;){Model snapshot;pthread_mutex_lock(&guard);snapshot=model;pthread_mutex_unlock(&guard);
        render(pixels,1280,720,&snapshot,platform_time());screen_flip(&pixels);platform_sleep(100);
    }
}
