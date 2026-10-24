#ifndef BRIDGE_MODEL_H
#define BRIDGE_MODEL_H
#include "platform.h"
#define JOBS 24
#define QUEUE_ITEMS 24
typedef struct { char title[96], status[16]; int position; } QueueItem;
typedef struct {
    int task, query_error;
    char title[160];
    Progress progress;
    uint64_t previous;
    double sampled, speed, updated;
    int has_sample, complete, cancelled;
} Job;
typedef struct {
    Job jobs[JOBS];
    int count, ready, controls;
    int confirm_task;
    double confirm_until;
    char ip[16], message[160];
    QueueItem queue[QUEUE_ITEMS]; int queue_count;
} Model;
int current_job(const Model *model);
int cancel_job(Model *model,int task);
void controller_action(Model *model,double now);
void sample(Job *job,const Progress *progress,double now);
void render(uint32_t *pixels,int width,int height,const Model *model,double now);
#endif
