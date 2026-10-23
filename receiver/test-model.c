#include "src/model.h"
#include <assert.h>
#include <math.h>
static int stops, stop_error;
int platform_cancel(int task){assert(task==42);stops++;return stop_error;}
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
 Model m={0};m.count=1;m.jobs[0].task=42;
 assert(current_job(&m)==0);controller_action(&m,10);assert(stops==0 && m.confirm_until==15);
 controller_action(&m,16);assert(stops==0); // expired confirmation does not stop
 stop_error=-9;controller_action(&m,17);assert(stops==1 && !m.jobs[0].cancelled && current_job(&m)==0);
 stop_error=0;controller_action(&m,18);assert(stops==1);controller_action(&m,19);
 assert(stops==2 && m.jobs[0].cancelled && current_job(&m)==-1);
 sample(&m.jobs[0],&p,20);assert(m.jobs[0].cancelled && !m.jobs[0].complete);
 assert(cancel_job(&m,42)==0 && stops==2);assert(cancel_job(&m,99)!=0);
 m.jobs[0].cancelled=0;m.jobs[0].progress.error=1;assert(current_job(&m)==-1);
 controller_action(&m,21);assert(stops==2); // dismiss error never cancels another task
 m.jobs[0].progress.error=0;m.jobs[0].complete=1;assert(current_job(&m)==-1);
 assert(cancel_job(&m,42)!=0 && stops==2);
 return 0;
}
