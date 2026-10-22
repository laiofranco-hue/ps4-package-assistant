#include "src/model.h"
#include <assert.h>
#include <math.h>
int main(void){
 Job job={0};Progress p={0};p.total=6000000000ULL;p.downloaded=4500000000ULL;p.seconds=10;
 sample(&job,&p,1);assert(!job.complete && job.speed==0);
 p.downloaded+=25000000ULL;sample(&job,&p,2);assert(fabs(job.speed-25000000)<1);
 sample(&job,&p,2.01);assert(fabs(job.speed-25000000)<1);
 sample(&job,&p,3);assert(job.speed==0 && !job.complete);
 p.total=0;sample(&job,&p,4);assert(!job.complete);
 p.total=p.downloaded;p.seconds=0;p.error=1;sample(&job,&p,5);assert(!job.complete);
 p.error=0;sample(&job,&p,6);assert(job.complete);
 p.downloaded=1;p.total=6000000000ULL;sample(&job,&p,7);assert(job.speed==0 && !job.complete);
 return 0;
}
