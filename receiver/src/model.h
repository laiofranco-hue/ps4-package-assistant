#ifndef BRIDGE_MODEL_H
#define BRIDGE_MODEL_H
#include "platform.h"
#define JOBS 24
typedef struct {
    int task, query_error;
    char title[160];
    Progress progress;
    uint64_t previous;
    double sampled, speed, updated;
    int has_sample, complete;
} Job;
typedef struct {
    Job jobs[JOBS];
    int count, ready;
    char ip[16], message[160];
} Model;
void sample(Job *job,const Progress *progress,double now);
void render(uint32_t *pixels,int width,int height,const Model *model,double now);
#endif
