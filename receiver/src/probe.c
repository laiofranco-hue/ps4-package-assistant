#include "platform.h"
/* Harmless install/launch probe. Draws OK; does not access games or network. */
int main(void){
    uint32_t *pixels;int width=1280,height=720;
    if(screen_open(&pixels,width,height))return 1;
    const unsigned char letters[2][7]={{14,17,17,17,17,17,14},{17,18,20,24,20,18,17}};
    for(;;){
        for(int i=0;i<width*height;i++)pixels[i]=0xff10131a;
        for(int letter=0;letter<2;letter++)for(int row=0;row<7;row++)for(int col=0;col<5;col++)if(letters[letter][row]&(1<<(4-col)))
            for(int y=0;y<30;y++)for(int x=0;x<30;x++)pixels[(240+row*30+y)*width+460+letter*210+col*30+x]=0xff55d69e;
        screen_flip(&pixels);platform_sleep(200);
    }
}
