#include "model.h"
#include <string.h>
#include <stdio.h>
void sample(Job *job,const Progress *p,double now) {
    if(job->cancelled)return;
    double delta=now-job->sampled;
    if(!job->has_sample || p->downloaded<job->previous || now<job->sampled || p->error){
        job->speed=0;job->previous=p->downloaded;job->sampled=now;job->has_sample=1;
    } else if(delta>=0.2){
        job->speed=(double)(p->downloaded-job->previous)/delta;
        job->previous=p->downloaded;job->sampled=now;
    }
    job->updated=now;
    job->progress=*p;
    job->complete=!p->error && p->total>0 && p->downloaded>=p->total && p->seconds==0;
    job->query_error=0;
}

int current_job(const Model *m){
    for(int i=0;i<m->count;i++)if(!m->jobs[i].complete && !m->jobs[i].cancelled && !m->jobs[i].progress.error)return i;
    return -1;
}
int cancel_job(Model *m,int task){
    for(int i=0;i<m->count;i++)if(m->jobs[i].task==task){
        Job *job=&m->jobs[i];
        if(job->cancelled)return 0;
        if(job->complete)return -2;
        int code=platform_cancel(task);
        if(code){snprintf(m->message,sizeof(m->message),"CANCELAMENTO NAO CONFIRMADO %08X. CONFIRA DOWNLOADS.",(unsigned)code);return code;}
        job->cancelled=1;job->speed=0;job->query_error=0;m->confirm_until=0;
        snprintf(m->message,sizeof(m->message),"TAREFA CANCELADA. AGUARDANDO NOVOS JOGOS.");return 0;
    }
    return -1;
}
void controller_action(Model *m,double now){
    int index=current_job(m);
    if(index<0){m->confirm_until=0;snprintf(m->message,sizeof(m->message),"AGUARDANDO NOVOS JOGOS. HISTORICO PRESERVADO.");return;}
    int task=m->jobs[index].task;
    if(m->confirm_until>now && m->confirm_task==task){m->confirm_until=0;cancel_job(m,task);}
    else {m->confirm_task=task;m->confirm_until=now+5;}
}
