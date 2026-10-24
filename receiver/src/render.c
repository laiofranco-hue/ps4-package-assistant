#include "model.h"
#include <stdio.h>
#include <string.h>
#include <ctype.h>
/* Small authored bitmap alphabet for the diagnostic build. No external font assets. */
static const char *alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .:/%_-?";
static const uint8_t glyphs[][7]={
{14,17,17,31,17,17,17},{30,17,17,30,17,17,30},{14,17,16,16,16,17,14},{30,17,17,17,17,17,30},
{31,16,16,30,16,16,31},{31,16,16,30,16,16,16},{14,17,16,23,17,17,14},{17,17,17,31,17,17,17},
{31,4,4,4,4,4,31},{7,2,2,2,18,18,12},{17,18,20,24,20,18,17},{16,16,16,16,16,16,31},
{17,27,21,21,17,17,17},{17,25,25,21,19,19,17},{14,17,17,17,17,17,14},{30,17,17,30,16,16,16},
{14,17,17,17,21,18,13},{30,17,17,30,20,18,17},{15,16,16,14,1,1,30},{31,4,4,4,4,4,4},
{17,17,17,17,17,17,14},{17,17,17,17,17,10,4},{17,17,17,21,21,21,10},{17,17,10,4,10,17,17},
{17,17,10,4,4,4,4},{31,1,2,4,8,16,31},{14,17,19,21,25,17,14},{4,12,4,4,4,4,14},
{14,17,1,2,4,8,31},{30,1,1,14,1,1,30},{2,6,10,18,31,2,2},{31,16,16,30,1,1,30},
{14,16,16,30,17,17,14},{31,1,2,4,8,8,8},{14,17,17,14,17,17,14},{14,17,17,15,1,1,14},
{0,0,0,0,0,0,0},{0,0,0,0,0,6,6},{0,6,6,0,6,6,0},{1,2,2,4,8,8,16},
{17,2,4,8,16,17,0},{0,0,0,0,0,0,31},{0,0,0,31,0,0,0},{14,17,1,2,4,0,4}};
static uint32_t *screen;static int w,h;
static void rect(int x,int y,int width,int height,uint32_t color) {
    for(int yy=y;yy<y+height && yy<h;yy++)for(int xx=x;xx<x+width && xx<w;xx++)
        if(xx>=0 && yy>=0)screen[yy*w+xx]=color;
}
static void text(int x,int y,int scale,const char *value,uint32_t color,int max) {
    for(int i=0;value[i] && i<max;i++) {
        unsigned char ch=(unsigned char)toupper((unsigned char)value[i]);
        const char *found=strchr(alphabet,ch);size_t index=found?(size_t)(found-alphabet):sizeof(glyphs)/sizeof(glyphs[0])-1;
        for(int row=0;row<7;row++)for(int col=0;col<5;col++)if(glyphs[index][row]&(1<<(4-col)))
            rect(x+i*6*scale+col*scale,y+row*scale,scale,scale,color);
    }
}
void render(uint32_t *pixels,int width,int height,const Model *m,double now) {
    screen=pixels;w=width;h=height;rect(0,0,w,h,0xff10131a);
    text(55,45,4,"PS4 PACKAGE ASSISTANT",0xfff3f5f8,44);
    char line[256];snprintf(line,sizeof(line),"IP %s : 12800 - PROTOTIPO",m->ip);text(55,100,2,line,0xff72a7ff,90);
    text(55,138,2,m->message,m->ready?0xffa6b0c0:0xffff8585,92);
    int current=current_job(m);
    if(current<0) {
        text(55,230,3,"AGUARDANDO NOVOS JOGOS",0xfff3f5f8,60);
        text(55,285,2,"MANTENHA ESTE APP ABERTO EM PRIMEIRO PLANO.",0xffa6b0c0,90);
    } else {
        const Job *job=&m->jobs[current];const Progress *p=&job->progress;
        text(55,210,3,job->title,0xfff3f5f8,60);
        double percent=p->total ? (double)p->downloaded*100.0/(double)p->total : 0;
        if(percent>100)percent=100;
        snprintf(line,sizeof(line),"%.1f%%   %.2f / %.2f GB",percent,p->downloaded/1e9,p->total/1e9);
        text(55,260,3,line,0xfff3f5f8,64);
        rect(55,310,1170,20,0xff303847);rect(55,310,(int)(1170*percent/100),20,0xff72a7ff);
        if(job->query_error)snprintf(line,sizeof(line),"SEM ATUALIZACAO - ERRO %08X",(unsigned)job->query_error);
        else if(p->error)snprintf(line,sizeof(line),"ERRO NA INSTALACAO %08X",(unsigned)p->error);
        else if(job->complete)snprintf(line,sizeof(line),"TRANSFERENCIA CONCLUIDA - CONFIRA O JOGO NO PS4");
        else if(!p->total)snprintf(line,sizeof(line),"PREPARANDO DOWNLOAD - AGUARDANDO TAMANHO TOTAL");
        else if(now-job->updated>3)snprintf(line,sizeof(line),"AGUARDANDO ATUALIZACAO DO CONSOLE");
        else snprintf(line,sizeof(line),"%.2f MB/S   RESTANTE %u S",job->speed/1e6,p->seconds);
        text(55,355,2,line,0xffa6b0c0,90);
    }
    if(m->controls){
        const char *action=current<0?"CIRCULO: VOLTAR AO MODO ESPERA":
            (m->confirm_until>now && m->confirm_task==m->jobs[current].task)?
            "CIRCULO NOVAMENTE: CONFIRMAR CANCELAMENTO": "CIRCULO: CANCELAR DOWNLOAD ATUAL";
        text(55,397,2,action,0xff72a7ff,92);
    }else text(55,397,2,"CONTROLE INDISPONIVEL. CANCELE PELO MAC OU DOWNLOADS.",0xffa6b0c0,92);
    text(55,430,2,"FILA NO MAC",0xff72a7ff,40);
    int first=m->count>5?m->count-5:0;
    for(int i=first;i<m->count;i++) {
        const Job *job=&m->jobs[i];
        snprintf(line,sizeof(line),"%s  %s",job->cancelled?"CANCELADO":job->progress.error?"ERRO":job->complete?"OK":job->query_error?"CONFERIR":"EM CURSO",job->title);
        text(55,470+(i-first)*33,2,line,0xfff3f5f8,92);
    }
    int qy=470+(m->count>5?5:m->count)*33;
    for(int i=0;i<m->queue_count && qy<640;i++,qy+=27){snprintf(line,sizeof(line),"%02d %s  %s",m->queue[i].position,m->queue[i].status,m->queue[i].title);text(55,qy,2,line,0xfff3f5f8,92);}
    text(55,668,2,"A FILA E A ORDEM SAO CONTROLADAS PELO MAC.",0xffa6b0c0,96);
}
