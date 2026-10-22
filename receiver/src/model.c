#include "model.h"
#include <string.h>
void sample(Job *job,const Progress *p,double now) {
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
