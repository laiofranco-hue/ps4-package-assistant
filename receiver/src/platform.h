#ifndef BRIDGE_PLATFORM_H
#define BRIDGE_PLATFORM_H
#include <stdint.h>
#include <stddef.h>

/* PS4 x86-64 BGFT ABI: unsigned long fields are 64-bit. */
typedef struct {
    uint32_t bits;
    int32_t error;
    uint64_t length, transferred, total, downloaded;
    uint32_t index, count, seconds, seconds_total;
    int32_t preparing, copying;
} Progress;
_Static_assert(sizeof(Progress)==64,"BGFT progress ABI");
_Static_assert(offsetof(Progress,downloaded)==32,"BGFT downloaded offset");

void platform_trace(const char *stage,int code);
int platform_init(char ip[16], char *error, size_t size);
int platform_install(const char *content_id,const char *url,const char *title,uint64_t size,int *task);
int platform_controls_init(void);
int platform_cancel_pressed(void);
int platform_cancel(int task);
int platform_progress(int task, Progress *progress);
int platform_exists(const char *title_id,int *exists);
double platform_time(void);
void platform_sleep(unsigned milliseconds);
int net_listen(int port);
int net_accept_ready(int server);
int net_read(int socket,void *data,size_t size);
int net_write(int socket,const void *data,size_t size);
void net_close(int socket);
int screen_open(uint32_t **pixels,int width,int height);
void screen_flip(uint32_t **pixels);
#endif
