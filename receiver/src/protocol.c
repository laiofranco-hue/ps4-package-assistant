#include "protocol.h"
#include "../vendor/cJSON.h"
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>

static cJSON *field(cJSON *object,const char *name){return cJSON_GetObjectItemCaseSensitive(object,name);}
static const char *string(cJSON *o,const char *key){cJSON *v=field(o,key);return cJSON_IsString(v)?v->valuestring:NULL;}
static cJSON *failure(int code,const char *message){
    cJSON *r=cJSON_CreateObject();cJSON_AddStringToObject(r,"status","fail");
    char value[20];snprintf(value,sizeof(value),"0x%08X",(unsigned)code);
    cJSON_AddStringToObject(r,"error_code",value);cJSON_AddStringToObject(r,"error",message);return r;
}
static int clean_string(const char *value,size_t max){
    if(!value || !*value || strlen(value)>max)return 0;
    for(const unsigned char *p=(const unsigned char*)value;*p;p++)if(*p<32)return 0;
    return 1;
}
static int content_id(const char *value){
    if(!value || strlen(value)!=36 || value[6]!='-' || value[16]!='_' || value[19]!='-')return 0;
    for(int i=0;i<36;i++)if(i!=6 && i!=16 && i!=19 && !((value[i]>='A'&&value[i]<='Z')||(value[i]>='0'&&value[i]<='9')))return 0;
    return 1;
}
static int task_id(cJSON *root,int *id){
    cJSON *value=field(root,"task_id");
    if(!cJSON_IsNumber(value)||value->valuedouble<0||value->valuedouble>2147483647||floor(value->valuedouble)!=value->valuedouble)return 0;
    *id=value->valueint;return 1;
}
char *command(Model *m,const char *route,const char *body,int *status){
    *status=200;
    const char *end=NULL;
    cJSON *root=cJSON_ParseWithOpts(body,&end,1),*r=NULL;
    if(!cJSON_IsObject(root)){*status=400;r=failure(-1,"JSON invalido.");goto done;}
    if(!strcmp(route,"/api/health")){
        r=cJSON_CreateObject();cJSON_AddStringToObject(r,"receiver","ps4-package-assistant");
        cJSON_AddStringToObject(r,"version","0.1.6");cJSON_AddBoolToObject(r,"ready",m->ready);goto done;
    }
    if(!m->ready){*status=503;r=failure(-2,m->message);goto done;}
    if(!strcmp(route,"/api/is_exists")){
        const char *title=string(root,"title_id");int exists=0;
        if(!title||strlen(title)!=9){*status=400;r=failure(-1,"Title ID invalido.");goto done;}
        int code=platform_exists(title,&exists);if(code){r=failure(code,"Falha ao consultar titulo.");goto done;}
        r=cJSON_CreateObject();cJSON_AddStringToObject(r,"status","success");cJSON_AddBoolToObject(r,"exists",exists);goto done;
    }
    if(!strcmp(route,"/api/get_task_progress")){
        int id;if(!task_id(root,&id)){*status=400;r=failure(-1,"task_id invalido.");goto done;}
        Progress p={0};int code=platform_progress(id,&p);
        if(code){r=failure(code,"Falha ao consultar progresso.");goto done;}
        double now=platform_time();for(int i=0;i<m->count;i++)if(m->jobs[i].task==id)sample(&m->jobs[i],&p,now);
        r=cJSON_CreateObject();cJSON_AddStringToObject(r,"status","success");
        cJSON_AddNumberToObject(r,"bits",p.bits);cJSON_AddNumberToObject(r,"error",p.error);
        cJSON_AddNumberToObject(r,"length_total",(double)p.total);cJSON_AddNumberToObject(r,"transferred_total",(double)p.downloaded);
        cJSON_AddNumberToObject(r,"rest_sec",p.seconds);cJSON_AddNumberToObject(r,"preparing_percent",p.preparing);cJSON_AddNumberToObject(r,"local_copy_percent",p.copying);goto done;
    }
    if(!strcmp(route,"/api/install")){
        const char *type=string(root,"type");cJSON *packages=field(root,"packages"),*bridge=field(root,"bridge");
        if(!type||strcmp(type,"direct")||!cJSON_IsArray(packages)||cJSON_GetArraySize(packages)!=1||!cJSON_IsObject(bridge)){
            *status=400;r=failure(-1,"Este prototipo requer um PKG completo enviado pelo PS4 Package Assistant atualizado.");goto done;
        }
        const char *url=string(bridge,"manifest_url"),*cid=string(bridge,"content_id"),*title=string(bridge,"title"),*kind=string(bridge,"package_type");
        cJSON *size=field(bridge,"size");
        if(!clean_string(url,2047)||strncmp(url,"http://",7)||!content_id(cid)||!clean_string(title,159)||!kind||strcmp(kind,"PS4GD")||!cJSON_IsNumber(size)||size->valuedouble<8192||size->valuedouble>9007199254740991.0||floor(size->valuedouble)!=size->valuedouble){
            *status=400;r=failure(-1,"Metadados do pacote invalidos; somente pacote base PS4GD nesta prova.");goto done;
        }
        if(m->count==JOBS){*status=409;r=failure(-1,"Historico da prova cheio. Reinicie o receptor apos concluir os envios.");goto done;}
        int id=-1,code=platform_install(cid,url,title,(uint64_t)size->valuedouble,&id);
        if(code && id<0){snprintf(m->message,sizeof(m->message),"INSTALACAO RECUSADA: %08X",(unsigned)code);r=failure(code,m->message);goto done;}
        if(id<0){r=failure(-1,"Resposta do BGFT sem tarefa valida. Confira Downloads.");goto done;}
        Job *job=&m->jobs[m->count++];memset(job,0,sizeof(*job));job->task=id;snprintf(job->title,sizeof(job->title),"%s",title);
        if(code){
            job->query_error=code;snprintf(m->message,sizeof(m->message),"TAREFA REGISTRADA MAS INICIO FALHOU: %08X. CONFIRA DOWNLOADS.",(unsigned)code);
            r=failure(code,m->message);cJSON_ReplaceItemInObjectCaseSensitive(r,"status",cJSON_CreateString("attention"));cJSON_AddNumberToObject(r,"task_id",id);goto done;
        }
        snprintf(m->message,sizeof(m->message),"PEDIDO ACEITO. MANTENHA O MAC E ESTE APP ABERTOS.");
        r=cJSON_CreateObject();cJSON_AddStringToObject(r,"status","success");cJSON_AddNumberToObject(r,"task_id",id);cJSON_AddStringToObject(r,"title",title);goto done;
    }
    *status=404;r=failure(-1,"Comando nao suportado nesta prova.");
done:
    cJSON_Delete(root);char *output=cJSON_PrintUnformatted(r);cJSON_Delete(r);return output;
}
