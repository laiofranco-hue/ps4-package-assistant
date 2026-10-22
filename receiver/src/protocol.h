#ifndef BRIDGE_PROTOCOL_H
#define BRIDGE_PROTOCOL_H
#include "model.h"
char *command(Model *model,const char *route,const char *body,int *http_status);
#endif
