
//===------------------------------------------------------------*- C++ -*-===//
//
// Automatically generated file for High-level Synthesis (HLS).
//
//===----------------------------------------------------------------------===//
#include <algorithm>
#include <ap_axi_sdata.h>
#include <ap_fixed.h>
#include <ap_int.h>
#include <hls_math.h>
#include <hls_stream.h>
#include <hls_vector.h>
#include <math.h>
#include <stdint.h>
using namespace std;

extern "C" {

void NEST_0(
  int8_t v0[8][8],
  int8_t v1[8][8][8],
  hls::stream< uint64_t >& v2
) {	// L4
  #pragma HLS array_partition variable=v0 complete dim=1

  #pragma HLS array_partition variable=v1 complete dim=1
  #pragma HLS array_partition variable=v1 complete dim=2
  #pragma HLS array_partition variable=v1 complete dim=3

  l_nest_i: for (int i = 0; i < 8; i++) {	// L11
    int8_t local_buffer[8];	// L12
    for (int v5 = 0; v5 < 8; v5++) {	// L13
      local_buffer[v5] = 0;	// L13
    }
    l_S_j_0_j: for (int j = 0; j < 8; j++) {	// L14
      int8_t temp;	// L15
      temp = 0;	// L16
      l_S_k_0_k: for (int k = 0; k < 8; k++) {	// L17
        int8_t v9 = v0[k][j];	// L18
        int8_t iAct;	// L19
        iAct = v9;	// L20
        int8_t v11 = v1[i][j][k];	// L21
        int8_t weight;	// L22
        weight = v11;	// L23
        int8_t v13 = iAct;	// L24
        int8_t v14 = weight;	// L25
        int16_t v15 = v13;	// L26
        int16_t v16 = v14;	// L27
        int16_t v17 = v15 * v16;	// L28
        int8_t v18 = temp;	// L29
        ap_int<17> v19 = v18;	// L30
        ap_int<17> v20 = v17;	// L31
        ap_int<17> v21 = v19 + v20;	// L32
        int8_t v22 = v21;	// L33
        temp = v22;	// L34
      }
      int8_t v23 = temp;	// L36
      local_buffer[j] = v23;	// L37
    }
    uint64_t local_result;	// L39
    local_result = 0;	// L40
    l_S_j_2_j1: for (int j1 = 0; j1 < 8; j1++) {	// L41
      int8_t v26 = local_buffer[j1];	// L42
      int64_t v27 = local_result;	// L43
      int v28 = j1 * 8;	// L44
      ap_int<34> v29 = j1;	// L45
      ap_int<34> v30 = v29 + 1;	// L46
      ap_int<66> v31 = v30;	// L47
      ap_int<66> v32 = v31 * 8;	// L48
      ap_int<66> v33 = v32 - 1;	// L49
      int v34 = v33;	// L50
      int64_t v35;
      ap_int<64> v35_tmp = v27;
      v35_tmp(v34, v28) = v26;
      v35 = v35_tmp;	// L51
      local_result = v35;	// L52
    }
    int64_t v36 = local_result;	// L54
    v2.write(v36);	// L55
  }
}

void bus_0(
  hls::stream< uint64_t >& v37,
  hls::stream< int8_t >& v38,
  hls::stream< int8_t >& v39,
  hls::stream< int8_t >& v40,
  hls::stream< int8_t >& v41,
  hls::stream< int8_t >& v42,
  hls::stream< int8_t >& v43,
  hls::stream< int8_t >& v44,
  hls::stream< int8_t >& v45
) {	// L59
  l_S___0__: for (int _ = 0; _ < 8; _++) {	// L76
    uint64_t v47 = v37.read();	// L77
    uint64_t array;	// L78
    array = v47;	// L79
    int64_t v49 = array;	// L80
    int8_t v50;
    ap_int<64> v50_tmp = v49;
    v50 = v50_tmp(7, 0);	// L81
    v38.write(v50);	// L82
    int64_t v51 = array;	// L83
    int8_t v52;
    ap_int<64> v52_tmp = v51;
    v52 = v52_tmp(15, 8);	// L84
    v39.write(v52);	// L85
    int64_t v53 = array;	// L86
    int8_t v54;
    ap_int<64> v54_tmp = v53;
    v54 = v54_tmp(23, 16);	// L87
    v40.write(v54);	// L88
    int64_t v55 = array;	// L89
    int8_t v56;
    ap_int<64> v56_tmp = v55;
    v56 = v56_tmp(31, 24);	// L90
    v41.write(v56);	// L91
    int64_t v57 = array;	// L92
    int8_t v58;
    ap_int<64> v58_tmp = v57;
    v58 = v58_tmp(39, 32);	// L93
    v42.write(v58);	// L94
    int64_t v59 = array;	// L95
    int8_t v60;
    ap_int<64> v60_tmp = v59;
    v60 = v60_tmp(47, 40);	// L96
    v43.write(v60);	// L97
    int64_t v61 = array;	// L98
    int8_t v62;
    ap_int<64> v62_tmp = v61;
    v62 = v62_tmp(55, 48);	// L99
    v44.write(v62);	// L100
    int64_t v63 = array;	// L101
    int8_t v64;
    ap_int<64> v64_tmp = v63;
    v64 = v64_tmp(63, 56);	// L102
    v45.write(v64);	// L103
  }
}

void inst_rw_0(
  int8_t v65[6][4],
  hls::stream< int8_t >& v66,
  hls::stream< int8_t >& v67,
  hls::stream< int8_t >& v68,
  hls::stream< int8_t >& v69,
  hls::stream< int8_t >& v70,
  hls::stream< int8_t >& v71,
  hls::stream< int8_t >& v72,
  hls::stream< int8_t >& v73,
  hls::stream< int8_t >& v74,
  hls::stream< int8_t >& v75,
  hls::stream< int8_t >& v76,
  hls::stream< int8_t >& v77,
  hls::stream< int8_t >& v78,
  hls::stream< int8_t >& v79,
  hls::stream< int8_t >& v80,
  hls::stream< int8_t >& v81,
  hls::stream< int8_t >& v82,
  hls::stream< int8_t >& v83,
  hls::stream< int8_t >& v84,
  hls::stream< int8_t >& v85,
  hls::stream< int8_t >& v86,
  hls::stream< int8_t >& v87,
  hls::stream< int8_t >& v88,
  hls::stream< int8_t >& v89
) {	// L107
  int8_t v90 = v65[0][0];	// L108
  v66.write(v90);	// L109
  int8_t v91 = v65[0][1];	// L110
  v67.write(v91);	// L111
  int8_t v92 = v65[0][2];	// L112
  v68.write(v92);	// L113
  int8_t v93 = v65[0][3];	// L114
  v69.write(v93);	// L115
  int8_t v94 = v65[1][0];	// L116
  v70.write(v94);	// L117
  int8_t v95 = v65[1][1];	// L118
  v71.write(v95);	// L119
  int8_t v96 = v65[1][2];	// L120
  v72.write(v96);	// L121
  int8_t v97 = v65[1][3];	// L122
  v73.write(v97);	// L123
  int8_t v98 = v65[2][0];	// L124
  v74.write(v98);	// L125
  int8_t v99 = v65[2][1];	// L126
  v75.write(v99);	// L127
  int8_t v100 = v65[2][2];	// L128
  v76.write(v100);	// L129
  int8_t v101 = v65[2][3];	// L130
  v77.write(v101);	// L131
  int8_t v102 = v65[3][0];	// L132
  v78.write(v102);	// L133
  int8_t v103 = v65[3][1];	// L134
  v79.write(v103);	// L135
  int8_t v104 = v65[3][2];	// L136
  v80.write(v104);	// L137
  int8_t v105 = v65[3][3];	// L138
  v81.write(v105);	// L139
  int8_t v106 = v65[4][0];	// L140
  v82.write(v106);	// L141
  int8_t v107 = v65[4][1];	// L142
  v83.write(v107);	// L143
  int8_t v108 = v65[4][2];	// L144
  v84.write(v108);	// L145
  int8_t v109 = v65[4][3];	// L146
  v85.write(v109);	// L147
  int8_t v110 = v65[5][0];	// L148
  v86.write(v110);	// L149
  int8_t v111 = v65[5][1];	// L150
  v87.write(v111);	// L151
  int8_t v112 = v65[5][2];	// L152
  v88.write(v112);	// L153
  int8_t v113 = v65[5][3];	// L154
  v89.write(v113);	// L155
}

void BIRRD_0_0(
  hls::stream< int8_t >& v114,
  hls::stream< int8_t >& v115,
  hls::stream< int8_t >& v116,
  hls::stream< int8_t >& v117,
  hls::stream< int8_t >& v118
) {	// L158
  int8_t v119 = v114.read();	// L163
  int8_t inst_val;	// L164
  inst_val = v119;	// L165
  l_S___0__1: for (int _1 = 0; _1 < 8; _1++) {	// L166
    int8_t v122 = v115.read();	// L167
    int8_t in_left;	// L168
    in_left = v122;	// L169
    int8_t v124 = v116.read();	// L170
    int8_t in_right;	// L171
    in_right = v124;	// L172
    int8_t out_left;	// L173
    out_left = 0;	// L174
    int8_t out_right;	// L175
    out_right = 0;	// L176
    int8_t v128 = inst_val;	// L177
    int32_t v129 = v128;	// L178
    bool v130 = v129 == 0;	// L179
    if (v130) {	// L180
      int8_t v131 = in_left;	// L181
      out_left = v131;	// L182
      int8_t v132 = in_right;	// L183
      out_right = v132;	// L184
    } else {
      int8_t v133 = inst_val;	// L186
      int32_t v134 = v133;	// L187
      bool v135 = v134 == 1;	// L188
      if (v135) {	// L189
        int8_t v136 = in_left;	// L190
        out_left = v136;	// L191
        int8_t v137 = in_left;	// L192
        int8_t v138 = in_right;	// L193
        ap_int<9> v139 = v137;	// L194
        ap_int<9> v140 = v138;	// L195
        ap_int<9> v141 = v139 + v140;	// L196
        int8_t v142 = v141;	// L197
        out_right = v142;	// L198
      } else {
        int8_t v143 = inst_val;	// L200
        int32_t v144 = v143;	// L201
        bool v145 = v144 == 2;	// L202
        if (v145) {	// L203
          int8_t v146 = in_left;	// L204
          int8_t v147 = in_right;	// L205
          ap_int<9> v148 = v146;	// L206
          ap_int<9> v149 = v147;	// L207
          ap_int<9> v150 = v148 + v149;	// L208
          int8_t v151 = v150;	// L209
          out_left = v151;	// L210
          int8_t v152 = in_right;	// L211
          out_right = v152;	// L212
        } else {
          int8_t v153 = in_right;	// L214
          out_left = v153;	// L215
          int8_t v154 = in_left;	// L216
          out_right = v154;	// L217
        }
      }
    }
    int8_t v155 = out_left;	// L221
    v117.write(v155);	// L222
    int8_t v156 = out_right;	// L223
    v118.write(v156);	// L224
  }
}

void BIRRD_0_1(
  hls::stream< int8_t >& v157,
  hls::stream< int8_t >& v158,
  hls::stream< int8_t >& v159,
  hls::stream< int8_t >& v160,
  hls::stream< int8_t >& v161
) {	// L228
  int8_t v162 = v157.read();	// L233
  int8_t inst_val1;	// L234
  inst_val1 = v162;	// L235
  l_S___0__2: for (int _2 = 0; _2 < 8; _2++) {	// L236
    int8_t v165 = v158.read();	// L237
    int8_t in_left1;	// L238
    in_left1 = v165;	// L239
    int8_t v167 = v159.read();	// L240
    int8_t in_right1;	// L241
    in_right1 = v167;	// L242
    int8_t out_left1;	// L243
    out_left1 = 0;	// L244
    int8_t out_right1;	// L245
    out_right1 = 0;	// L246
    int8_t v171 = inst_val1;	// L247
    int32_t v172 = v171;	// L248
    bool v173 = v172 == 0;	// L249
    if (v173) {	// L250
      int8_t v174 = in_left1;	// L251
      out_left1 = v174;	// L252
      int8_t v175 = in_right1;	// L253
      out_right1 = v175;	// L254
    } else {
      int8_t v176 = inst_val1;	// L256
      int32_t v177 = v176;	// L257
      bool v178 = v177 == 1;	// L258
      if (v178) {	// L259
        int8_t v179 = in_left1;	// L260
        out_left1 = v179;	// L261
        int8_t v180 = in_left1;	// L262
        int8_t v181 = in_right1;	// L263
        ap_int<9> v182 = v180;	// L264
        ap_int<9> v183 = v181;	// L265
        ap_int<9> v184 = v182 + v183;	// L266
        int8_t v185 = v184;	// L267
        out_right1 = v185;	// L268
      } else {
        int8_t v186 = inst_val1;	// L270
        int32_t v187 = v186;	// L271
        bool v188 = v187 == 2;	// L272
        if (v188) {	// L273
          int8_t v189 = in_left1;	// L274
          int8_t v190 = in_right1;	// L275
          ap_int<9> v191 = v189;	// L276
          ap_int<9> v192 = v190;	// L277
          ap_int<9> v193 = v191 + v192;	// L278
          int8_t v194 = v193;	// L279
          out_left1 = v194;	// L280
          int8_t v195 = in_right1;	// L281
          out_right1 = v195;	// L282
        } else {
          int8_t v196 = in_right1;	// L284
          out_left1 = v196;	// L285
          int8_t v197 = in_left1;	// L286
          out_right1 = v197;	// L287
        }
      }
    }
    int8_t v198 = out_left1;	// L291
    v160.write(v198);	// L292
    int8_t v199 = out_right1;	// L293
    v161.write(v199);	// L294
  }
}

void BIRRD_0_2(
  hls::stream< int8_t >& v200,
  hls::stream< int8_t >& v201,
  hls::stream< int8_t >& v202,
  hls::stream< int8_t >& v203,
  hls::stream< int8_t >& v204
) {	// L298
  int8_t v205 = v200.read();	// L303
  int8_t inst_val2;	// L304
  inst_val2 = v205;	// L305
  l_S___0__3: for (int _3 = 0; _3 < 8; _3++) {	// L306
    int8_t v208 = v201.read();	// L307
    int8_t in_left2;	// L308
    in_left2 = v208;	// L309
    int8_t v210 = v202.read();	// L310
    int8_t in_right2;	// L311
    in_right2 = v210;	// L312
    int8_t out_left2;	// L313
    out_left2 = 0;	// L314
    int8_t out_right2;	// L315
    out_right2 = 0;	// L316
    int8_t v214 = inst_val2;	// L317
    int32_t v215 = v214;	// L318
    bool v216 = v215 == 0;	// L319
    if (v216) {	// L320
      int8_t v217 = in_left2;	// L321
      out_left2 = v217;	// L322
      int8_t v218 = in_right2;	// L323
      out_right2 = v218;	// L324
    } else {
      int8_t v219 = inst_val2;	// L326
      int32_t v220 = v219;	// L327
      bool v221 = v220 == 1;	// L328
      if (v221) {	// L329
        int8_t v222 = in_left2;	// L330
        out_left2 = v222;	// L331
        int8_t v223 = in_left2;	// L332
        int8_t v224 = in_right2;	// L333
        ap_int<9> v225 = v223;	// L334
        ap_int<9> v226 = v224;	// L335
        ap_int<9> v227 = v225 + v226;	// L336
        int8_t v228 = v227;	// L337
        out_right2 = v228;	// L338
      } else {
        int8_t v229 = inst_val2;	// L340
        int32_t v230 = v229;	// L341
        bool v231 = v230 == 2;	// L342
        if (v231) {	// L343
          int8_t v232 = in_left2;	// L344
          int8_t v233 = in_right2;	// L345
          ap_int<9> v234 = v232;	// L346
          ap_int<9> v235 = v233;	// L347
          ap_int<9> v236 = v234 + v235;	// L348
          int8_t v237 = v236;	// L349
          out_left2 = v237;	// L350
          int8_t v238 = in_right2;	// L351
          out_right2 = v238;	// L352
        } else {
          int8_t v239 = in_right2;	// L354
          out_left2 = v239;	// L355
          int8_t v240 = in_left2;	// L356
          out_right2 = v240;	// L357
        }
      }
    }
    int8_t v241 = out_left2;	// L361
    v203.write(v241);	// L362
    int8_t v242 = out_right2;	// L363
    v204.write(v242);	// L364
  }
}

void BIRRD_0_3(
  hls::stream< int8_t >& v243,
  hls::stream< int8_t >& v244,
  hls::stream< int8_t >& v245,
  hls::stream< int8_t >& v246,
  hls::stream< int8_t >& v247
) {	// L368
  int8_t v248 = v243.read();	// L373
  int8_t inst_val3;	// L374
  inst_val3 = v248;	// L375
  l_S___0__4: for (int _4 = 0; _4 < 8; _4++) {	// L376
    int8_t v251 = v244.read();	// L377
    int8_t in_left3;	// L378
    in_left3 = v251;	// L379
    int8_t v253 = v245.read();	// L380
    int8_t in_right3;	// L381
    in_right3 = v253;	// L382
    int8_t out_left3;	// L383
    out_left3 = 0;	// L384
    int8_t out_right3;	// L385
    out_right3 = 0;	// L386
    int8_t v257 = inst_val3;	// L387
    int32_t v258 = v257;	// L388
    bool v259 = v258 == 0;	// L389
    if (v259) {	// L390
      int8_t v260 = in_left3;	// L391
      out_left3 = v260;	// L392
      int8_t v261 = in_right3;	// L393
      out_right3 = v261;	// L394
    } else {
      int8_t v262 = inst_val3;	// L396
      int32_t v263 = v262;	// L397
      bool v264 = v263 == 1;	// L398
      if (v264) {	// L399
        int8_t v265 = in_left3;	// L400
        out_left3 = v265;	// L401
        int8_t v266 = in_left3;	// L402
        int8_t v267 = in_right3;	// L403
        ap_int<9> v268 = v266;	// L404
        ap_int<9> v269 = v267;	// L405
        ap_int<9> v270 = v268 + v269;	// L406
        int8_t v271 = v270;	// L407
        out_right3 = v271;	// L408
      } else {
        int8_t v272 = inst_val3;	// L410
        int32_t v273 = v272;	// L411
        bool v274 = v273 == 2;	// L412
        if (v274) {	// L413
          int8_t v275 = in_left3;	// L414
          int8_t v276 = in_right3;	// L415
          ap_int<9> v277 = v275;	// L416
          ap_int<9> v278 = v276;	// L417
          ap_int<9> v279 = v277 + v278;	// L418
          int8_t v280 = v279;	// L419
          out_left3 = v280;	// L420
          int8_t v281 = in_right3;	// L421
          out_right3 = v281;	// L422
        } else {
          int8_t v282 = in_right3;	// L424
          out_left3 = v282;	// L425
          int8_t v283 = in_left3;	// L426
          out_right3 = v283;	// L427
        }
      }
    }
    int8_t v284 = out_left3;	// L431
    v246.write(v284);	// L432
    int8_t v285 = out_right3;	// L433
    v247.write(v285);	// L434
  }
}

void BIRRD_1_0(
  hls::stream< int8_t >& v286,
  hls::stream< int8_t >& v287,
  hls::stream< int8_t >& v288,
  hls::stream< int8_t >& v289,
  hls::stream< int8_t >& v290
) {	// L438
  int8_t v291 = v286.read();	// L443
  int8_t inst_val4;	// L444
  inst_val4 = v291;	// L445
  l_S___0__5: for (int _5 = 0; _5 < 8; _5++) {	// L446
    int8_t v294 = v287.read();	// L447
    int8_t in_left4;	// L448
    in_left4 = v294;	// L449
    int8_t v296 = v288.read();	// L450
    int8_t in_right4;	// L451
    in_right4 = v296;	// L452
    int8_t out_left4;	// L453
    out_left4 = 0;	// L454
    int8_t out_right4;	// L455
    out_right4 = 0;	// L456
    int8_t v300 = inst_val4;	// L457
    int32_t v301 = v300;	// L458
    bool v302 = v301 == 0;	// L459
    if (v302) {	// L460
      int8_t v303 = in_left4;	// L461
      out_left4 = v303;	// L462
      int8_t v304 = in_right4;	// L463
      out_right4 = v304;	// L464
    } else {
      int8_t v305 = inst_val4;	// L466
      int32_t v306 = v305;	// L467
      bool v307 = v306 == 1;	// L468
      if (v307) {	// L469
        int8_t v308 = in_left4;	// L470
        out_left4 = v308;	// L471
        int8_t v309 = in_left4;	// L472
        int8_t v310 = in_right4;	// L473
        ap_int<9> v311 = v309;	// L474
        ap_int<9> v312 = v310;	// L475
        ap_int<9> v313 = v311 + v312;	// L476
        int8_t v314 = v313;	// L477
        out_right4 = v314;	// L478
      } else {
        int8_t v315 = inst_val4;	// L480
        int32_t v316 = v315;	// L481
        bool v317 = v316 == 2;	// L482
        if (v317) {	// L483
          int8_t v318 = in_left4;	// L484
          int8_t v319 = in_right4;	// L485
          ap_int<9> v320 = v318;	// L486
          ap_int<9> v321 = v319;	// L487
          ap_int<9> v322 = v320 + v321;	// L488
          int8_t v323 = v322;	// L489
          out_left4 = v323;	// L490
          int8_t v324 = in_right4;	// L491
          out_right4 = v324;	// L492
        } else {
          int8_t v325 = in_right4;	// L494
          out_left4 = v325;	// L495
          int8_t v326 = in_left4;	// L496
          out_right4 = v326;	// L497
        }
      }
    }
    int8_t v327 = out_left4;	// L501
    v289.write(v327);	// L502
    int8_t v328 = out_right4;	// L503
    v290.write(v328);	// L504
  }
}

void BIRRD_1_1(
  hls::stream< int8_t >& v329,
  hls::stream< int8_t >& v330,
  hls::stream< int8_t >& v331,
  hls::stream< int8_t >& v332,
  hls::stream< int8_t >& v333
) {	// L508
  int8_t v334 = v329.read();	// L513
  int8_t inst_val5;	// L514
  inst_val5 = v334;	// L515
  l_S___0__6: for (int _6 = 0; _6 < 8; _6++) {	// L516
    int8_t v337 = v330.read();	// L517
    int8_t in_left5;	// L518
    in_left5 = v337;	// L519
    int8_t v339 = v331.read();	// L520
    int8_t in_right5;	// L521
    in_right5 = v339;	// L522
    int8_t out_left5;	// L523
    out_left5 = 0;	// L524
    int8_t out_right5;	// L525
    out_right5 = 0;	// L526
    int8_t v343 = inst_val5;	// L527
    int32_t v344 = v343;	// L528
    bool v345 = v344 == 0;	// L529
    if (v345) {	// L530
      int8_t v346 = in_left5;	// L531
      out_left5 = v346;	// L532
      int8_t v347 = in_right5;	// L533
      out_right5 = v347;	// L534
    } else {
      int8_t v348 = inst_val5;	// L536
      int32_t v349 = v348;	// L537
      bool v350 = v349 == 1;	// L538
      if (v350) {	// L539
        int8_t v351 = in_left5;	// L540
        out_left5 = v351;	// L541
        int8_t v352 = in_left5;	// L542
        int8_t v353 = in_right5;	// L543
        ap_int<9> v354 = v352;	// L544
        ap_int<9> v355 = v353;	// L545
        ap_int<9> v356 = v354 + v355;	// L546
        int8_t v357 = v356;	// L547
        out_right5 = v357;	// L548
      } else {
        int8_t v358 = inst_val5;	// L550
        int32_t v359 = v358;	// L551
        bool v360 = v359 == 2;	// L552
        if (v360) {	// L553
          int8_t v361 = in_left5;	// L554
          int8_t v362 = in_right5;	// L555
          ap_int<9> v363 = v361;	// L556
          ap_int<9> v364 = v362;	// L557
          ap_int<9> v365 = v363 + v364;	// L558
          int8_t v366 = v365;	// L559
          out_left5 = v366;	// L560
          int8_t v367 = in_right5;	// L561
          out_right5 = v367;	// L562
        } else {
          int8_t v368 = in_right5;	// L564
          out_left5 = v368;	// L565
          int8_t v369 = in_left5;	// L566
          out_right5 = v369;	// L567
        }
      }
    }
    int8_t v370 = out_left5;	// L571
    v332.write(v370);	// L572
    int8_t v371 = out_right5;	// L573
    v333.write(v371);	// L574
  }
}

void BIRRD_1_2(
  hls::stream< int8_t >& v372,
  hls::stream< int8_t >& v373,
  hls::stream< int8_t >& v374,
  hls::stream< int8_t >& v375,
  hls::stream< int8_t >& v376
) {	// L578
  int8_t v377 = v372.read();	// L583
  int8_t inst_val6;	// L584
  inst_val6 = v377;	// L585
  l_S___0__7: for (int _7 = 0; _7 < 8; _7++) {	// L586
    int8_t v380 = v373.read();	// L587
    int8_t in_left6;	// L588
    in_left6 = v380;	// L589
    int8_t v382 = v374.read();	// L590
    int8_t in_right6;	// L591
    in_right6 = v382;	// L592
    int8_t out_left6;	// L593
    out_left6 = 0;	// L594
    int8_t out_right6;	// L595
    out_right6 = 0;	// L596
    int8_t v386 = inst_val6;	// L597
    int32_t v387 = v386;	// L598
    bool v388 = v387 == 0;	// L599
    if (v388) {	// L600
      int8_t v389 = in_left6;	// L601
      out_left6 = v389;	// L602
      int8_t v390 = in_right6;	// L603
      out_right6 = v390;	// L604
    } else {
      int8_t v391 = inst_val6;	// L606
      int32_t v392 = v391;	// L607
      bool v393 = v392 == 1;	// L608
      if (v393) {	// L609
        int8_t v394 = in_left6;	// L610
        out_left6 = v394;	// L611
        int8_t v395 = in_left6;	// L612
        int8_t v396 = in_right6;	// L613
        ap_int<9> v397 = v395;	// L614
        ap_int<9> v398 = v396;	// L615
        ap_int<9> v399 = v397 + v398;	// L616
        int8_t v400 = v399;	// L617
        out_right6 = v400;	// L618
      } else {
        int8_t v401 = inst_val6;	// L620
        int32_t v402 = v401;	// L621
        bool v403 = v402 == 2;	// L622
        if (v403) {	// L623
          int8_t v404 = in_left6;	// L624
          int8_t v405 = in_right6;	// L625
          ap_int<9> v406 = v404;	// L626
          ap_int<9> v407 = v405;	// L627
          ap_int<9> v408 = v406 + v407;	// L628
          int8_t v409 = v408;	// L629
          out_left6 = v409;	// L630
          int8_t v410 = in_right6;	// L631
          out_right6 = v410;	// L632
        } else {
          int8_t v411 = in_right6;	// L634
          out_left6 = v411;	// L635
          int8_t v412 = in_left6;	// L636
          out_right6 = v412;	// L637
        }
      }
    }
    int8_t v413 = out_left6;	// L641
    v375.write(v413);	// L642
    int8_t v414 = out_right6;	// L643
    v376.write(v414);	// L644
  }
}

void BIRRD_1_3(
  hls::stream< int8_t >& v415,
  hls::stream< int8_t >& v416,
  hls::stream< int8_t >& v417,
  hls::stream< int8_t >& v418,
  hls::stream< int8_t >& v419
) {	// L648
  int8_t v420 = v415.read();	// L653
  int8_t inst_val7;	// L654
  inst_val7 = v420;	// L655
  l_S___0__8: for (int _8 = 0; _8 < 8; _8++) {	// L656
    int8_t v423 = v416.read();	// L657
    int8_t in_left7;	// L658
    in_left7 = v423;	// L659
    int8_t v425 = v417.read();	// L660
    int8_t in_right7;	// L661
    in_right7 = v425;	// L662
    int8_t out_left7;	// L663
    out_left7 = 0;	// L664
    int8_t out_right7;	// L665
    out_right7 = 0;	// L666
    int8_t v429 = inst_val7;	// L667
    int32_t v430 = v429;	// L668
    bool v431 = v430 == 0;	// L669
    if (v431) {	// L670
      int8_t v432 = in_left7;	// L671
      out_left7 = v432;	// L672
      int8_t v433 = in_right7;	// L673
      out_right7 = v433;	// L674
    } else {
      int8_t v434 = inst_val7;	// L676
      int32_t v435 = v434;	// L677
      bool v436 = v435 == 1;	// L678
      if (v436) {	// L679
        int8_t v437 = in_left7;	// L680
        out_left7 = v437;	// L681
        int8_t v438 = in_left7;	// L682
        int8_t v439 = in_right7;	// L683
        ap_int<9> v440 = v438;	// L684
        ap_int<9> v441 = v439;	// L685
        ap_int<9> v442 = v440 + v441;	// L686
        int8_t v443 = v442;	// L687
        out_right7 = v443;	// L688
      } else {
        int8_t v444 = inst_val7;	// L690
        int32_t v445 = v444;	// L691
        bool v446 = v445 == 2;	// L692
        if (v446) {	// L693
          int8_t v447 = in_left7;	// L694
          int8_t v448 = in_right7;	// L695
          ap_int<9> v449 = v447;	// L696
          ap_int<9> v450 = v448;	// L697
          ap_int<9> v451 = v449 + v450;	// L698
          int8_t v452 = v451;	// L699
          out_left7 = v452;	// L700
          int8_t v453 = in_right7;	// L701
          out_right7 = v453;	// L702
        } else {
          int8_t v454 = in_right7;	// L704
          out_left7 = v454;	// L705
          int8_t v455 = in_left7;	// L706
          out_right7 = v455;	// L707
        }
      }
    }
    int8_t v456 = out_left7;	// L711
    v418.write(v456);	// L712
    int8_t v457 = out_right7;	// L713
    v419.write(v457);	// L714
  }
}

void BIRRD_2_0(
  hls::stream< int8_t >& v458,
  hls::stream< int8_t >& v459,
  hls::stream< int8_t >& v460,
  hls::stream< int8_t >& v461,
  hls::stream< int8_t >& v462
) {	// L718
  int8_t v463 = v458.read();	// L723
  int8_t inst_val8;	// L724
  inst_val8 = v463;	// L725
  l_S___0__9: for (int _9 = 0; _9 < 8; _9++) {	// L726
    int8_t v466 = v459.read();	// L727
    int8_t in_left8;	// L728
    in_left8 = v466;	// L729
    int8_t v468 = v460.read();	// L730
    int8_t in_right8;	// L731
    in_right8 = v468;	// L732
    int8_t out_left8;	// L733
    out_left8 = 0;	// L734
    int8_t out_right8;	// L735
    out_right8 = 0;	// L736
    int8_t v472 = inst_val8;	// L737
    int32_t v473 = v472;	// L738
    bool v474 = v473 == 0;	// L739
    if (v474) {	// L740
      int8_t v475 = in_left8;	// L741
      out_left8 = v475;	// L742
      int8_t v476 = in_right8;	// L743
      out_right8 = v476;	// L744
    } else {
      int8_t v477 = inst_val8;	// L746
      int32_t v478 = v477;	// L747
      bool v479 = v478 == 1;	// L748
      if (v479) {	// L749
        int8_t v480 = in_left8;	// L750
        out_left8 = v480;	// L751
        int8_t v481 = in_left8;	// L752
        int8_t v482 = in_right8;	// L753
        ap_int<9> v483 = v481;	// L754
        ap_int<9> v484 = v482;	// L755
        ap_int<9> v485 = v483 + v484;	// L756
        int8_t v486 = v485;	// L757
        out_right8 = v486;	// L758
      } else {
        int8_t v487 = inst_val8;	// L760
        int32_t v488 = v487;	// L761
        bool v489 = v488 == 2;	// L762
        if (v489) {	// L763
          int8_t v490 = in_left8;	// L764
          int8_t v491 = in_right8;	// L765
          ap_int<9> v492 = v490;	// L766
          ap_int<9> v493 = v491;	// L767
          ap_int<9> v494 = v492 + v493;	// L768
          int8_t v495 = v494;	// L769
          out_left8 = v495;	// L770
          int8_t v496 = in_right8;	// L771
          out_right8 = v496;	// L772
        } else {
          int8_t v497 = in_right8;	// L774
          out_left8 = v497;	// L775
          int8_t v498 = in_left8;	// L776
          out_right8 = v498;	// L777
        }
      }
    }
    int8_t v499 = out_left8;	// L781
    v461.write(v499);	// L782
    int8_t v500 = out_right8;	// L783
    v462.write(v500);	// L784
  }
}

void BIRRD_2_1(
  hls::stream< int8_t >& v501,
  hls::stream< int8_t >& v502,
  hls::stream< int8_t >& v503,
  hls::stream< int8_t >& v504,
  hls::stream< int8_t >& v505
) {	// L788
  int8_t v506 = v501.read();	// L793
  int8_t inst_val9;	// L794
  inst_val9 = v506;	// L795
  l_S___0__10: for (int _10 = 0; _10 < 8; _10++) {	// L796
    int8_t v509 = v502.read();	// L797
    int8_t in_left9;	// L798
    in_left9 = v509;	// L799
    int8_t v511 = v503.read();	// L800
    int8_t in_right9;	// L801
    in_right9 = v511;	// L802
    int8_t out_left9;	// L803
    out_left9 = 0;	// L804
    int8_t out_right9;	// L805
    out_right9 = 0;	// L806
    int8_t v515 = inst_val9;	// L807
    int32_t v516 = v515;	// L808
    bool v517 = v516 == 0;	// L809
    if (v517) {	// L810
      int8_t v518 = in_left9;	// L811
      out_left9 = v518;	// L812
      int8_t v519 = in_right9;	// L813
      out_right9 = v519;	// L814
    } else {
      int8_t v520 = inst_val9;	// L816
      int32_t v521 = v520;	// L817
      bool v522 = v521 == 1;	// L818
      if (v522) {	// L819
        int8_t v523 = in_left9;	// L820
        out_left9 = v523;	// L821
        int8_t v524 = in_left9;	// L822
        int8_t v525 = in_right9;	// L823
        ap_int<9> v526 = v524;	// L824
        ap_int<9> v527 = v525;	// L825
        ap_int<9> v528 = v526 + v527;	// L826
        int8_t v529 = v528;	// L827
        out_right9 = v529;	// L828
      } else {
        int8_t v530 = inst_val9;	// L830
        int32_t v531 = v530;	// L831
        bool v532 = v531 == 2;	// L832
        if (v532) {	// L833
          int8_t v533 = in_left9;	// L834
          int8_t v534 = in_right9;	// L835
          ap_int<9> v535 = v533;	// L836
          ap_int<9> v536 = v534;	// L837
          ap_int<9> v537 = v535 + v536;	// L838
          int8_t v538 = v537;	// L839
          out_left9 = v538;	// L840
          int8_t v539 = in_right9;	// L841
          out_right9 = v539;	// L842
        } else {
          int8_t v540 = in_right9;	// L844
          out_left9 = v540;	// L845
          int8_t v541 = in_left9;	// L846
          out_right9 = v541;	// L847
        }
      }
    }
    int8_t v542 = out_left9;	// L851
    v504.write(v542);	// L852
    int8_t v543 = out_right9;	// L853
    v505.write(v543);	// L854
  }
}

void BIRRD_2_2(
  hls::stream< int8_t >& v544,
  hls::stream< int8_t >& v545,
  hls::stream< int8_t >& v546,
  hls::stream< int8_t >& v547,
  hls::stream< int8_t >& v548
) {	// L858
  int8_t v549 = v544.read();	// L863
  int8_t inst_val10;	// L864
  inst_val10 = v549;	// L865
  l_S___0__11: for (int _11 = 0; _11 < 8; _11++) {	// L866
    int8_t v552 = v545.read();	// L867
    int8_t in_left10;	// L868
    in_left10 = v552;	// L869
    int8_t v554 = v546.read();	// L870
    int8_t in_right10;	// L871
    in_right10 = v554;	// L872
    int8_t out_left10;	// L873
    out_left10 = 0;	// L874
    int8_t out_right10;	// L875
    out_right10 = 0;	// L876
    int8_t v558 = inst_val10;	// L877
    int32_t v559 = v558;	// L878
    bool v560 = v559 == 0;	// L879
    if (v560) {	// L880
      int8_t v561 = in_left10;	// L881
      out_left10 = v561;	// L882
      int8_t v562 = in_right10;	// L883
      out_right10 = v562;	// L884
    } else {
      int8_t v563 = inst_val10;	// L886
      int32_t v564 = v563;	// L887
      bool v565 = v564 == 1;	// L888
      if (v565) {	// L889
        int8_t v566 = in_left10;	// L890
        out_left10 = v566;	// L891
        int8_t v567 = in_left10;	// L892
        int8_t v568 = in_right10;	// L893
        ap_int<9> v569 = v567;	// L894
        ap_int<9> v570 = v568;	// L895
        ap_int<9> v571 = v569 + v570;	// L896
        int8_t v572 = v571;	// L897
        out_right10 = v572;	// L898
      } else {
        int8_t v573 = inst_val10;	// L900
        int32_t v574 = v573;	// L901
        bool v575 = v574 == 2;	// L902
        if (v575) {	// L903
          int8_t v576 = in_left10;	// L904
          int8_t v577 = in_right10;	// L905
          ap_int<9> v578 = v576;	// L906
          ap_int<9> v579 = v577;	// L907
          ap_int<9> v580 = v578 + v579;	// L908
          int8_t v581 = v580;	// L909
          out_left10 = v581;	// L910
          int8_t v582 = in_right10;	// L911
          out_right10 = v582;	// L912
        } else {
          int8_t v583 = in_right10;	// L914
          out_left10 = v583;	// L915
          int8_t v584 = in_left10;	// L916
          out_right10 = v584;	// L917
        }
      }
    }
    int8_t v585 = out_left10;	// L921
    v547.write(v585);	// L922
    int8_t v586 = out_right10;	// L923
    v548.write(v586);	// L924
  }
}

void BIRRD_2_3(
  hls::stream< int8_t >& v587,
  hls::stream< int8_t >& v588,
  hls::stream< int8_t >& v589,
  hls::stream< int8_t >& v590,
  hls::stream< int8_t >& v591
) {	// L928
  int8_t v592 = v587.read();	// L933
  int8_t inst_val11;	// L934
  inst_val11 = v592;	// L935
  l_S___0__12: for (int _12 = 0; _12 < 8; _12++) {	// L936
    int8_t v595 = v588.read();	// L937
    int8_t in_left11;	// L938
    in_left11 = v595;	// L939
    int8_t v597 = v589.read();	// L940
    int8_t in_right11;	// L941
    in_right11 = v597;	// L942
    int8_t out_left11;	// L943
    out_left11 = 0;	// L944
    int8_t out_right11;	// L945
    out_right11 = 0;	// L946
    int8_t v601 = inst_val11;	// L947
    int32_t v602 = v601;	// L948
    bool v603 = v602 == 0;	// L949
    if (v603) {	// L950
      int8_t v604 = in_left11;	// L951
      out_left11 = v604;	// L952
      int8_t v605 = in_right11;	// L953
      out_right11 = v605;	// L954
    } else {
      int8_t v606 = inst_val11;	// L956
      int32_t v607 = v606;	// L957
      bool v608 = v607 == 1;	// L958
      if (v608) {	// L959
        int8_t v609 = in_left11;	// L960
        out_left11 = v609;	// L961
        int8_t v610 = in_left11;	// L962
        int8_t v611 = in_right11;	// L963
        ap_int<9> v612 = v610;	// L964
        ap_int<9> v613 = v611;	// L965
        ap_int<9> v614 = v612 + v613;	// L966
        int8_t v615 = v614;	// L967
        out_right11 = v615;	// L968
      } else {
        int8_t v616 = inst_val11;	// L970
        int32_t v617 = v616;	// L971
        bool v618 = v617 == 2;	// L972
        if (v618) {	// L973
          int8_t v619 = in_left11;	// L974
          int8_t v620 = in_right11;	// L975
          ap_int<9> v621 = v619;	// L976
          ap_int<9> v622 = v620;	// L977
          ap_int<9> v623 = v621 + v622;	// L978
          int8_t v624 = v623;	// L979
          out_left11 = v624;	// L980
          int8_t v625 = in_right11;	// L981
          out_right11 = v625;	// L982
        } else {
          int8_t v626 = in_right11;	// L984
          out_left11 = v626;	// L985
          int8_t v627 = in_left11;	// L986
          out_right11 = v627;	// L987
        }
      }
    }
    int8_t v628 = out_left11;	// L991
    v590.write(v628);	// L992
    int8_t v629 = out_right11;	// L993
    v591.write(v629);	// L994
  }
}

void BIRRD_3_0(
  hls::stream< int8_t >& v630,
  hls::stream< int8_t >& v631,
  hls::stream< int8_t >& v632,
  hls::stream< int8_t >& v633,
  hls::stream< int8_t >& v634
) {	// L998
  int8_t v635 = v630.read();	// L1003
  int8_t inst_val12;	// L1004
  inst_val12 = v635;	// L1005
  l_S___0__13: for (int _13 = 0; _13 < 8; _13++) {	// L1006
    int8_t v638 = v631.read();	// L1007
    int8_t in_left12;	// L1008
    in_left12 = v638;	// L1009
    int8_t v640 = v632.read();	// L1010
    int8_t in_right12;	// L1011
    in_right12 = v640;	// L1012
    int8_t out_left12;	// L1013
    out_left12 = 0;	// L1014
    int8_t out_right12;	// L1015
    out_right12 = 0;	// L1016
    int8_t v644 = inst_val12;	// L1017
    int32_t v645 = v644;	// L1018
    bool v646 = v645 == 0;	// L1019
    if (v646) {	// L1020
      int8_t v647 = in_left12;	// L1021
      out_left12 = v647;	// L1022
      int8_t v648 = in_right12;	// L1023
      out_right12 = v648;	// L1024
    } else {
      int8_t v649 = inst_val12;	// L1026
      int32_t v650 = v649;	// L1027
      bool v651 = v650 == 1;	// L1028
      if (v651) {	// L1029
        int8_t v652 = in_left12;	// L1030
        out_left12 = v652;	// L1031
        int8_t v653 = in_left12;	// L1032
        int8_t v654 = in_right12;	// L1033
        ap_int<9> v655 = v653;	// L1034
        ap_int<9> v656 = v654;	// L1035
        ap_int<9> v657 = v655 + v656;	// L1036
        int8_t v658 = v657;	// L1037
        out_right12 = v658;	// L1038
      } else {
        int8_t v659 = inst_val12;	// L1040
        int32_t v660 = v659;	// L1041
        bool v661 = v660 == 2;	// L1042
        if (v661) {	// L1043
          int8_t v662 = in_left12;	// L1044
          int8_t v663 = in_right12;	// L1045
          ap_int<9> v664 = v662;	// L1046
          ap_int<9> v665 = v663;	// L1047
          ap_int<9> v666 = v664 + v665;	// L1048
          int8_t v667 = v666;	// L1049
          out_left12 = v667;	// L1050
          int8_t v668 = in_right12;	// L1051
          out_right12 = v668;	// L1052
        } else {
          int8_t v669 = in_right12;	// L1054
          out_left12 = v669;	// L1055
          int8_t v670 = in_left12;	// L1056
          out_right12 = v670;	// L1057
        }
      }
    }
    int8_t v671 = out_left12;	// L1061
    v633.write(v671);	// L1062
    int8_t v672 = out_right12;	// L1063
    v634.write(v672);	// L1064
  }
}

void BIRRD_3_1(
  hls::stream< int8_t >& v673,
  hls::stream< int8_t >& v674,
  hls::stream< int8_t >& v675,
  hls::stream< int8_t >& v676,
  hls::stream< int8_t >& v677
) {	// L1068
  int8_t v678 = v673.read();	// L1073
  int8_t inst_val13;	// L1074
  inst_val13 = v678;	// L1075
  l_S___0__14: for (int _14 = 0; _14 < 8; _14++) {	// L1076
    int8_t v681 = v674.read();	// L1077
    int8_t in_left13;	// L1078
    in_left13 = v681;	// L1079
    int8_t v683 = v675.read();	// L1080
    int8_t in_right13;	// L1081
    in_right13 = v683;	// L1082
    int8_t out_left13;	// L1083
    out_left13 = 0;	// L1084
    int8_t out_right13;	// L1085
    out_right13 = 0;	// L1086
    int8_t v687 = inst_val13;	// L1087
    int32_t v688 = v687;	// L1088
    bool v689 = v688 == 0;	// L1089
    if (v689) {	// L1090
      int8_t v690 = in_left13;	// L1091
      out_left13 = v690;	// L1092
      int8_t v691 = in_right13;	// L1093
      out_right13 = v691;	// L1094
    } else {
      int8_t v692 = inst_val13;	// L1096
      int32_t v693 = v692;	// L1097
      bool v694 = v693 == 1;	// L1098
      if (v694) {	// L1099
        int8_t v695 = in_left13;	// L1100
        out_left13 = v695;	// L1101
        int8_t v696 = in_left13;	// L1102
        int8_t v697 = in_right13;	// L1103
        ap_int<9> v698 = v696;	// L1104
        ap_int<9> v699 = v697;	// L1105
        ap_int<9> v700 = v698 + v699;	// L1106
        int8_t v701 = v700;	// L1107
        out_right13 = v701;	// L1108
      } else {
        int8_t v702 = inst_val13;	// L1110
        int32_t v703 = v702;	// L1111
        bool v704 = v703 == 2;	// L1112
        if (v704) {	// L1113
          int8_t v705 = in_left13;	// L1114
          int8_t v706 = in_right13;	// L1115
          ap_int<9> v707 = v705;	// L1116
          ap_int<9> v708 = v706;	// L1117
          ap_int<9> v709 = v707 + v708;	// L1118
          int8_t v710 = v709;	// L1119
          out_left13 = v710;	// L1120
          int8_t v711 = in_right13;	// L1121
          out_right13 = v711;	// L1122
        } else {
          int8_t v712 = in_right13;	// L1124
          out_left13 = v712;	// L1125
          int8_t v713 = in_left13;	// L1126
          out_right13 = v713;	// L1127
        }
      }
    }
    int8_t v714 = out_left13;	// L1131
    v676.write(v714);	// L1132
    int8_t v715 = out_right13;	// L1133
    v677.write(v715);	// L1134
  }
}

void BIRRD_3_2(
  hls::stream< int8_t >& v716,
  hls::stream< int8_t >& v717,
  hls::stream< int8_t >& v718,
  hls::stream< int8_t >& v719,
  hls::stream< int8_t >& v720
) {	// L1138
  int8_t v721 = v716.read();	// L1143
  int8_t inst_val14;	// L1144
  inst_val14 = v721;	// L1145
  l_S___0__15: for (int _15 = 0; _15 < 8; _15++) {	// L1146
    int8_t v724 = v717.read();	// L1147
    int8_t in_left14;	// L1148
    in_left14 = v724;	// L1149
    int8_t v726 = v718.read();	// L1150
    int8_t in_right14;	// L1151
    in_right14 = v726;	// L1152
    int8_t out_left14;	// L1153
    out_left14 = 0;	// L1154
    int8_t out_right14;	// L1155
    out_right14 = 0;	// L1156
    int8_t v730 = inst_val14;	// L1157
    int32_t v731 = v730;	// L1158
    bool v732 = v731 == 0;	// L1159
    if (v732) {	// L1160
      int8_t v733 = in_left14;	// L1161
      out_left14 = v733;	// L1162
      int8_t v734 = in_right14;	// L1163
      out_right14 = v734;	// L1164
    } else {
      int8_t v735 = inst_val14;	// L1166
      int32_t v736 = v735;	// L1167
      bool v737 = v736 == 1;	// L1168
      if (v737) {	// L1169
        int8_t v738 = in_left14;	// L1170
        out_left14 = v738;	// L1171
        int8_t v739 = in_left14;	// L1172
        int8_t v740 = in_right14;	// L1173
        ap_int<9> v741 = v739;	// L1174
        ap_int<9> v742 = v740;	// L1175
        ap_int<9> v743 = v741 + v742;	// L1176
        int8_t v744 = v743;	// L1177
        out_right14 = v744;	// L1178
      } else {
        int8_t v745 = inst_val14;	// L1180
        int32_t v746 = v745;	// L1181
        bool v747 = v746 == 2;	// L1182
        if (v747) {	// L1183
          int8_t v748 = in_left14;	// L1184
          int8_t v749 = in_right14;	// L1185
          ap_int<9> v750 = v748;	// L1186
          ap_int<9> v751 = v749;	// L1187
          ap_int<9> v752 = v750 + v751;	// L1188
          int8_t v753 = v752;	// L1189
          out_left14 = v753;	// L1190
          int8_t v754 = in_right14;	// L1191
          out_right14 = v754;	// L1192
        } else {
          int8_t v755 = in_right14;	// L1194
          out_left14 = v755;	// L1195
          int8_t v756 = in_left14;	// L1196
          out_right14 = v756;	// L1197
        }
      }
    }
    int8_t v757 = out_left14;	// L1201
    v719.write(v757);	// L1202
    int8_t v758 = out_right14;	// L1203
    v720.write(v758);	// L1204
  }
}

void BIRRD_3_3(
  hls::stream< int8_t >& v759,
  hls::stream< int8_t >& v760,
  hls::stream< int8_t >& v761,
  hls::stream< int8_t >& v762,
  hls::stream< int8_t >& v763
) {	// L1208
  int8_t v764 = v759.read();	// L1213
  int8_t inst_val15;	// L1214
  inst_val15 = v764;	// L1215
  l_S___0__16: for (int _16 = 0; _16 < 8; _16++) {	// L1216
    int8_t v767 = v760.read();	// L1217
    int8_t in_left15;	// L1218
    in_left15 = v767;	// L1219
    int8_t v769 = v761.read();	// L1220
    int8_t in_right15;	// L1221
    in_right15 = v769;	// L1222
    int8_t out_left15;	// L1223
    out_left15 = 0;	// L1224
    int8_t out_right15;	// L1225
    out_right15 = 0;	// L1226
    int8_t v773 = inst_val15;	// L1227
    int32_t v774 = v773;	// L1228
    bool v775 = v774 == 0;	// L1229
    if (v775) {	// L1230
      int8_t v776 = in_left15;	// L1231
      out_left15 = v776;	// L1232
      int8_t v777 = in_right15;	// L1233
      out_right15 = v777;	// L1234
    } else {
      int8_t v778 = inst_val15;	// L1236
      int32_t v779 = v778;	// L1237
      bool v780 = v779 == 1;	// L1238
      if (v780) {	// L1239
        int8_t v781 = in_left15;	// L1240
        out_left15 = v781;	// L1241
        int8_t v782 = in_left15;	// L1242
        int8_t v783 = in_right15;	// L1243
        ap_int<9> v784 = v782;	// L1244
        ap_int<9> v785 = v783;	// L1245
        ap_int<9> v786 = v784 + v785;	// L1246
        int8_t v787 = v786;	// L1247
        out_right15 = v787;	// L1248
      } else {
        int8_t v788 = inst_val15;	// L1250
        int32_t v789 = v788;	// L1251
        bool v790 = v789 == 2;	// L1252
        if (v790) {	// L1253
          int8_t v791 = in_left15;	// L1254
          int8_t v792 = in_right15;	// L1255
          ap_int<9> v793 = v791;	// L1256
          ap_int<9> v794 = v792;	// L1257
          ap_int<9> v795 = v793 + v794;	// L1258
          int8_t v796 = v795;	// L1259
          out_left15 = v796;	// L1260
          int8_t v797 = in_right15;	// L1261
          out_right15 = v797;	// L1262
        } else {
          int8_t v798 = in_right15;	// L1264
          out_left15 = v798;	// L1265
          int8_t v799 = in_left15;	// L1266
          out_right15 = v799;	// L1267
        }
      }
    }
    int8_t v800 = out_left15;	// L1271
    v762.write(v800);	// L1272
    int8_t v801 = out_right15;	// L1273
    v763.write(v801);	// L1274
  }
}

void BIRRD_4_0(
  hls::stream< int8_t >& v802,
  hls::stream< int8_t >& v803,
  hls::stream< int8_t >& v804,
  hls::stream< int8_t >& v805,
  hls::stream< int8_t >& v806
) {	// L1278
  int8_t v807 = v802.read();	// L1283
  int8_t inst_val16;	// L1284
  inst_val16 = v807;	// L1285
  l_S___0__17: for (int _17 = 0; _17 < 8; _17++) {	// L1286
    int8_t v810 = v803.read();	// L1287
    int8_t in_left16;	// L1288
    in_left16 = v810;	// L1289
    int8_t v812 = v804.read();	// L1290
    int8_t in_right16;	// L1291
    in_right16 = v812;	// L1292
    int8_t out_left16;	// L1293
    out_left16 = 0;	// L1294
    int8_t out_right16;	// L1295
    out_right16 = 0;	// L1296
    int8_t v816 = inst_val16;	// L1297
    int32_t v817 = v816;	// L1298
    bool v818 = v817 == 0;	// L1299
    if (v818) {	// L1300
      int8_t v819 = in_left16;	// L1301
      out_left16 = v819;	// L1302
      int8_t v820 = in_right16;	// L1303
      out_right16 = v820;	// L1304
    } else {
      int8_t v821 = inst_val16;	// L1306
      int32_t v822 = v821;	// L1307
      bool v823 = v822 == 1;	// L1308
      if (v823) {	// L1309
        int8_t v824 = in_left16;	// L1310
        out_left16 = v824;	// L1311
        int8_t v825 = in_left16;	// L1312
        int8_t v826 = in_right16;	// L1313
        ap_int<9> v827 = v825;	// L1314
        ap_int<9> v828 = v826;	// L1315
        ap_int<9> v829 = v827 + v828;	// L1316
        int8_t v830 = v829;	// L1317
        out_right16 = v830;	// L1318
      } else {
        int8_t v831 = inst_val16;	// L1320
        int32_t v832 = v831;	// L1321
        bool v833 = v832 == 2;	// L1322
        if (v833) {	// L1323
          int8_t v834 = in_left16;	// L1324
          int8_t v835 = in_right16;	// L1325
          ap_int<9> v836 = v834;	// L1326
          ap_int<9> v837 = v835;	// L1327
          ap_int<9> v838 = v836 + v837;	// L1328
          int8_t v839 = v838;	// L1329
          out_left16 = v839;	// L1330
          int8_t v840 = in_right16;	// L1331
          out_right16 = v840;	// L1332
        } else {
          int8_t v841 = in_right16;	// L1334
          out_left16 = v841;	// L1335
          int8_t v842 = in_left16;	// L1336
          out_right16 = v842;	// L1337
        }
      }
    }
    int8_t v843 = out_left16;	// L1341
    v805.write(v843);	// L1342
    int8_t v844 = out_right16;	// L1343
    v806.write(v844);	// L1344
  }
}

void BIRRD_4_1(
  hls::stream< int8_t >& v845,
  hls::stream< int8_t >& v846,
  hls::stream< int8_t >& v847,
  hls::stream< int8_t >& v848,
  hls::stream< int8_t >& v849
) {	// L1348
  int8_t v850 = v845.read();	// L1353
  int8_t inst_val17;	// L1354
  inst_val17 = v850;	// L1355
  l_S___0__18: for (int _18 = 0; _18 < 8; _18++) {	// L1356
    int8_t v853 = v846.read();	// L1357
    int8_t in_left17;	// L1358
    in_left17 = v853;	// L1359
    int8_t v855 = v847.read();	// L1360
    int8_t in_right17;	// L1361
    in_right17 = v855;	// L1362
    int8_t out_left17;	// L1363
    out_left17 = 0;	// L1364
    int8_t out_right17;	// L1365
    out_right17 = 0;	// L1366
    int8_t v859 = inst_val17;	// L1367
    int32_t v860 = v859;	// L1368
    bool v861 = v860 == 0;	// L1369
    if (v861) {	// L1370
      int8_t v862 = in_left17;	// L1371
      out_left17 = v862;	// L1372
      int8_t v863 = in_right17;	// L1373
      out_right17 = v863;	// L1374
    } else {
      int8_t v864 = inst_val17;	// L1376
      int32_t v865 = v864;	// L1377
      bool v866 = v865 == 1;	// L1378
      if (v866) {	// L1379
        int8_t v867 = in_left17;	// L1380
        out_left17 = v867;	// L1381
        int8_t v868 = in_left17;	// L1382
        int8_t v869 = in_right17;	// L1383
        ap_int<9> v870 = v868;	// L1384
        ap_int<9> v871 = v869;	// L1385
        ap_int<9> v872 = v870 + v871;	// L1386
        int8_t v873 = v872;	// L1387
        out_right17 = v873;	// L1388
      } else {
        int8_t v874 = inst_val17;	// L1390
        int32_t v875 = v874;	// L1391
        bool v876 = v875 == 2;	// L1392
        if (v876) {	// L1393
          int8_t v877 = in_left17;	// L1394
          int8_t v878 = in_right17;	// L1395
          ap_int<9> v879 = v877;	// L1396
          ap_int<9> v880 = v878;	// L1397
          ap_int<9> v881 = v879 + v880;	// L1398
          int8_t v882 = v881;	// L1399
          out_left17 = v882;	// L1400
          int8_t v883 = in_right17;	// L1401
          out_right17 = v883;	// L1402
        } else {
          int8_t v884 = in_right17;	// L1404
          out_left17 = v884;	// L1405
          int8_t v885 = in_left17;	// L1406
          out_right17 = v885;	// L1407
        }
      }
    }
    int8_t v886 = out_left17;	// L1411
    v848.write(v886);	// L1412
    int8_t v887 = out_right17;	// L1413
    v849.write(v887);	// L1414
  }
}

void BIRRD_4_2(
  hls::stream< int8_t >& v888,
  hls::stream< int8_t >& v889,
  hls::stream< int8_t >& v890,
  hls::stream< int8_t >& v891,
  hls::stream< int8_t >& v892
) {	// L1418
  int8_t v893 = v888.read();	// L1423
  int8_t inst_val18;	// L1424
  inst_val18 = v893;	// L1425
  l_S___0__19: for (int _19 = 0; _19 < 8; _19++) {	// L1426
    int8_t v896 = v889.read();	// L1427
    int8_t in_left18;	// L1428
    in_left18 = v896;	// L1429
    int8_t v898 = v890.read();	// L1430
    int8_t in_right18;	// L1431
    in_right18 = v898;	// L1432
    int8_t out_left18;	// L1433
    out_left18 = 0;	// L1434
    int8_t out_right18;	// L1435
    out_right18 = 0;	// L1436
    int8_t v902 = inst_val18;	// L1437
    int32_t v903 = v902;	// L1438
    bool v904 = v903 == 0;	// L1439
    if (v904) {	// L1440
      int8_t v905 = in_left18;	// L1441
      out_left18 = v905;	// L1442
      int8_t v906 = in_right18;	// L1443
      out_right18 = v906;	// L1444
    } else {
      int8_t v907 = inst_val18;	// L1446
      int32_t v908 = v907;	// L1447
      bool v909 = v908 == 1;	// L1448
      if (v909) {	// L1449
        int8_t v910 = in_left18;	// L1450
        out_left18 = v910;	// L1451
        int8_t v911 = in_left18;	// L1452
        int8_t v912 = in_right18;	// L1453
        ap_int<9> v913 = v911;	// L1454
        ap_int<9> v914 = v912;	// L1455
        ap_int<9> v915 = v913 + v914;	// L1456
        int8_t v916 = v915;	// L1457
        out_right18 = v916;	// L1458
      } else {
        int8_t v917 = inst_val18;	// L1460
        int32_t v918 = v917;	// L1461
        bool v919 = v918 == 2;	// L1462
        if (v919) {	// L1463
          int8_t v920 = in_left18;	// L1464
          int8_t v921 = in_right18;	// L1465
          ap_int<9> v922 = v920;	// L1466
          ap_int<9> v923 = v921;	// L1467
          ap_int<9> v924 = v922 + v923;	// L1468
          int8_t v925 = v924;	// L1469
          out_left18 = v925;	// L1470
          int8_t v926 = in_right18;	// L1471
          out_right18 = v926;	// L1472
        } else {
          int8_t v927 = in_right18;	// L1474
          out_left18 = v927;	// L1475
          int8_t v928 = in_left18;	// L1476
          out_right18 = v928;	// L1477
        }
      }
    }
    int8_t v929 = out_left18;	// L1481
    v891.write(v929);	// L1482
    int8_t v930 = out_right18;	// L1483
    v892.write(v930);	// L1484
  }
}

void BIRRD_4_3(
  hls::stream< int8_t >& v931,
  hls::stream< int8_t >& v932,
  hls::stream< int8_t >& v933,
  hls::stream< int8_t >& v934,
  hls::stream< int8_t >& v935
) {	// L1488
  int8_t v936 = v931.read();	// L1493
  int8_t inst_val19;	// L1494
  inst_val19 = v936;	// L1495
  l_S___0__20: for (int _20 = 0; _20 < 8; _20++) {	// L1496
    int8_t v939 = v932.read();	// L1497
    int8_t in_left19;	// L1498
    in_left19 = v939;	// L1499
    int8_t v941 = v933.read();	// L1500
    int8_t in_right19;	// L1501
    in_right19 = v941;	// L1502
    int8_t out_left19;	// L1503
    out_left19 = 0;	// L1504
    int8_t out_right19;	// L1505
    out_right19 = 0;	// L1506
    int8_t v945 = inst_val19;	// L1507
    int32_t v946 = v945;	// L1508
    bool v947 = v946 == 0;	// L1509
    if (v947) {	// L1510
      int8_t v948 = in_left19;	// L1511
      out_left19 = v948;	// L1512
      int8_t v949 = in_right19;	// L1513
      out_right19 = v949;	// L1514
    } else {
      int8_t v950 = inst_val19;	// L1516
      int32_t v951 = v950;	// L1517
      bool v952 = v951 == 1;	// L1518
      if (v952) {	// L1519
        int8_t v953 = in_left19;	// L1520
        out_left19 = v953;	// L1521
        int8_t v954 = in_left19;	// L1522
        int8_t v955 = in_right19;	// L1523
        ap_int<9> v956 = v954;	// L1524
        ap_int<9> v957 = v955;	// L1525
        ap_int<9> v958 = v956 + v957;	// L1526
        int8_t v959 = v958;	// L1527
        out_right19 = v959;	// L1528
      } else {
        int8_t v960 = inst_val19;	// L1530
        int32_t v961 = v960;	// L1531
        bool v962 = v961 == 2;	// L1532
        if (v962) {	// L1533
          int8_t v963 = in_left19;	// L1534
          int8_t v964 = in_right19;	// L1535
          ap_int<9> v965 = v963;	// L1536
          ap_int<9> v966 = v964;	// L1537
          ap_int<9> v967 = v965 + v966;	// L1538
          int8_t v968 = v967;	// L1539
          out_left19 = v968;	// L1540
          int8_t v969 = in_right19;	// L1541
          out_right19 = v969;	// L1542
        } else {
          int8_t v970 = in_right19;	// L1544
          out_left19 = v970;	// L1545
          int8_t v971 = in_left19;	// L1546
          out_right19 = v971;	// L1547
        }
      }
    }
    int8_t v972 = out_left19;	// L1551
    v934.write(v972);	// L1552
    int8_t v973 = out_right19;	// L1553
    v935.write(v973);	// L1554
  }
}

void BIRRD_5_0(
  hls::stream< int8_t >& v974,
  hls::stream< int8_t >& v975,
  hls::stream< int8_t >& v976,
  hls::stream< int8_t >& v977,
  hls::stream< int8_t >& v978
) {	// L1558
  int8_t v979 = v974.read();	// L1563
  int8_t inst_val20;	// L1564
  inst_val20 = v979;	// L1565
  l_S___0__21: for (int _21 = 0; _21 < 8; _21++) {	// L1566
    int8_t v982 = v975.read();	// L1567
    int8_t in_left20;	// L1568
    in_left20 = v982;	// L1569
    int8_t v984 = v976.read();	// L1570
    int8_t in_right20;	// L1571
    in_right20 = v984;	// L1572
    int8_t out_left20;	// L1573
    out_left20 = 0;	// L1574
    int8_t out_right20;	// L1575
    out_right20 = 0;	// L1576
    int8_t v988 = inst_val20;	// L1577
    int32_t v989 = v988;	// L1578
    bool v990 = v989 == 0;	// L1579
    if (v990) {	// L1580
      int8_t v991 = in_left20;	// L1581
      out_left20 = v991;	// L1582
      int8_t v992 = in_right20;	// L1583
      out_right20 = v992;	// L1584
    } else {
      int8_t v993 = inst_val20;	// L1586
      int32_t v994 = v993;	// L1587
      bool v995 = v994 == 1;	// L1588
      if (v995) {	// L1589
        int8_t v996 = in_left20;	// L1590
        out_left20 = v996;	// L1591
        int8_t v997 = in_left20;	// L1592
        int8_t v998 = in_right20;	// L1593
        ap_int<9> v999 = v997;	// L1594
        ap_int<9> v1000 = v998;	// L1595
        ap_int<9> v1001 = v999 + v1000;	// L1596
        int8_t v1002 = v1001;	// L1597
        out_right20 = v1002;	// L1598
      } else {
        int8_t v1003 = inst_val20;	// L1600
        int32_t v1004 = v1003;	// L1601
        bool v1005 = v1004 == 2;	// L1602
        if (v1005) {	// L1603
          int8_t v1006 = in_left20;	// L1604
          int8_t v1007 = in_right20;	// L1605
          ap_int<9> v1008 = v1006;	// L1606
          ap_int<9> v1009 = v1007;	// L1607
          ap_int<9> v1010 = v1008 + v1009;	// L1608
          int8_t v1011 = v1010;	// L1609
          out_left20 = v1011;	// L1610
          int8_t v1012 = in_right20;	// L1611
          out_right20 = v1012;	// L1612
        } else {
          int8_t v1013 = in_right20;	// L1614
          out_left20 = v1013;	// L1615
          int8_t v1014 = in_left20;	// L1616
          out_right20 = v1014;	// L1617
        }
      }
    }
    int8_t v1015 = out_left20;	// L1621
    v977.write(v1015);	// L1622
    int8_t v1016 = out_right20;	// L1623
    v978.write(v1016);	// L1624
  }
}

void BIRRD_5_1(
  hls::stream< int8_t >& v1017,
  hls::stream< int8_t >& v1018,
  hls::stream< int8_t >& v1019,
  hls::stream< int8_t >& v1020,
  hls::stream< int8_t >& v1021
) {	// L1628
  int8_t v1022 = v1017.read();	// L1633
  int8_t inst_val21;	// L1634
  inst_val21 = v1022;	// L1635
  l_S___0__22: for (int _22 = 0; _22 < 8; _22++) {	// L1636
    int8_t v1025 = v1018.read();	// L1637
    int8_t in_left21;	// L1638
    in_left21 = v1025;	// L1639
    int8_t v1027 = v1019.read();	// L1640
    int8_t in_right21;	// L1641
    in_right21 = v1027;	// L1642
    int8_t out_left21;	// L1643
    out_left21 = 0;	// L1644
    int8_t out_right21;	// L1645
    out_right21 = 0;	// L1646
    int8_t v1031 = inst_val21;	// L1647
    int32_t v1032 = v1031;	// L1648
    bool v1033 = v1032 == 0;	// L1649
    if (v1033) {	// L1650
      int8_t v1034 = in_left21;	// L1651
      out_left21 = v1034;	// L1652
      int8_t v1035 = in_right21;	// L1653
      out_right21 = v1035;	// L1654
    } else {
      int8_t v1036 = inst_val21;	// L1656
      int32_t v1037 = v1036;	// L1657
      bool v1038 = v1037 == 1;	// L1658
      if (v1038) {	// L1659
        int8_t v1039 = in_left21;	// L1660
        out_left21 = v1039;	// L1661
        int8_t v1040 = in_left21;	// L1662
        int8_t v1041 = in_right21;	// L1663
        ap_int<9> v1042 = v1040;	// L1664
        ap_int<9> v1043 = v1041;	// L1665
        ap_int<9> v1044 = v1042 + v1043;	// L1666
        int8_t v1045 = v1044;	// L1667
        out_right21 = v1045;	// L1668
      } else {
        int8_t v1046 = inst_val21;	// L1670
        int32_t v1047 = v1046;	// L1671
        bool v1048 = v1047 == 2;	// L1672
        if (v1048) {	// L1673
          int8_t v1049 = in_left21;	// L1674
          int8_t v1050 = in_right21;	// L1675
          ap_int<9> v1051 = v1049;	// L1676
          ap_int<9> v1052 = v1050;	// L1677
          ap_int<9> v1053 = v1051 + v1052;	// L1678
          int8_t v1054 = v1053;	// L1679
          out_left21 = v1054;	// L1680
          int8_t v1055 = in_right21;	// L1681
          out_right21 = v1055;	// L1682
        } else {
          int8_t v1056 = in_right21;	// L1684
          out_left21 = v1056;	// L1685
          int8_t v1057 = in_left21;	// L1686
          out_right21 = v1057;	// L1687
        }
      }
    }
    int8_t v1058 = out_left21;	// L1691
    v1020.write(v1058);	// L1692
    int8_t v1059 = out_right21;	// L1693
    v1021.write(v1059);	// L1694
  }
}

void BIRRD_5_2(
  hls::stream< int8_t >& v1060,
  hls::stream< int8_t >& v1061,
  hls::stream< int8_t >& v1062,
  hls::stream< int8_t >& v1063,
  hls::stream< int8_t >& v1064
) {	// L1698
  int8_t v1065 = v1060.read();	// L1703
  int8_t inst_val22;	// L1704
  inst_val22 = v1065;	// L1705
  l_S___0__23: for (int _23 = 0; _23 < 8; _23++) {	// L1706
    int8_t v1068 = v1061.read();	// L1707
    int8_t in_left22;	// L1708
    in_left22 = v1068;	// L1709
    int8_t v1070 = v1062.read();	// L1710
    int8_t in_right22;	// L1711
    in_right22 = v1070;	// L1712
    int8_t out_left22;	// L1713
    out_left22 = 0;	// L1714
    int8_t out_right22;	// L1715
    out_right22 = 0;	// L1716
    int8_t v1074 = inst_val22;	// L1717
    int32_t v1075 = v1074;	// L1718
    bool v1076 = v1075 == 0;	// L1719
    if (v1076) {	// L1720
      int8_t v1077 = in_left22;	// L1721
      out_left22 = v1077;	// L1722
      int8_t v1078 = in_right22;	// L1723
      out_right22 = v1078;	// L1724
    } else {
      int8_t v1079 = inst_val22;	// L1726
      int32_t v1080 = v1079;	// L1727
      bool v1081 = v1080 == 1;	// L1728
      if (v1081) {	// L1729
        int8_t v1082 = in_left22;	// L1730
        out_left22 = v1082;	// L1731
        int8_t v1083 = in_left22;	// L1732
        int8_t v1084 = in_right22;	// L1733
        ap_int<9> v1085 = v1083;	// L1734
        ap_int<9> v1086 = v1084;	// L1735
        ap_int<9> v1087 = v1085 + v1086;	// L1736
        int8_t v1088 = v1087;	// L1737
        out_right22 = v1088;	// L1738
      } else {
        int8_t v1089 = inst_val22;	// L1740
        int32_t v1090 = v1089;	// L1741
        bool v1091 = v1090 == 2;	// L1742
        if (v1091) {	// L1743
          int8_t v1092 = in_left22;	// L1744
          int8_t v1093 = in_right22;	// L1745
          ap_int<9> v1094 = v1092;	// L1746
          ap_int<9> v1095 = v1093;	// L1747
          ap_int<9> v1096 = v1094 + v1095;	// L1748
          int8_t v1097 = v1096;	// L1749
          out_left22 = v1097;	// L1750
          int8_t v1098 = in_right22;	// L1751
          out_right22 = v1098;	// L1752
        } else {
          int8_t v1099 = in_right22;	// L1754
          out_left22 = v1099;	// L1755
          int8_t v1100 = in_left22;	// L1756
          out_right22 = v1100;	// L1757
        }
      }
    }
    int8_t v1101 = out_left22;	// L1761
    v1063.write(v1101);	// L1762
    int8_t v1102 = out_right22;	// L1763
    v1064.write(v1102);	// L1764
  }
}

void BIRRD_5_3(
  hls::stream< int8_t >& v1103,
  hls::stream< int8_t >& v1104,
  hls::stream< int8_t >& v1105,
  hls::stream< int8_t >& v1106,
  hls::stream< int8_t >& v1107
) {	// L1768
  int8_t v1108 = v1103.read();	// L1773
  int8_t inst_val23;	// L1774
  inst_val23 = v1108;	// L1775
  l_S___0__24: for (int _24 = 0; _24 < 8; _24++) {	// L1776
    int8_t v1111 = v1104.read();	// L1777
    int8_t in_left23;	// L1778
    in_left23 = v1111;	// L1779
    int8_t v1113 = v1105.read();	// L1780
    int8_t in_right23;	// L1781
    in_right23 = v1113;	// L1782
    int8_t out_left23;	// L1783
    out_left23 = 0;	// L1784
    int8_t out_right23;	// L1785
    out_right23 = 0;	// L1786
    int8_t v1117 = inst_val23;	// L1787
    int32_t v1118 = v1117;	// L1788
    bool v1119 = v1118 == 0;	// L1789
    if (v1119) {	// L1790
      int8_t v1120 = in_left23;	// L1791
      out_left23 = v1120;	// L1792
      int8_t v1121 = in_right23;	// L1793
      out_right23 = v1121;	// L1794
    } else {
      int8_t v1122 = inst_val23;	// L1796
      int32_t v1123 = v1122;	// L1797
      bool v1124 = v1123 == 1;	// L1798
      if (v1124) {	// L1799
        int8_t v1125 = in_left23;	// L1800
        out_left23 = v1125;	// L1801
        int8_t v1126 = in_left23;	// L1802
        int8_t v1127 = in_right23;	// L1803
        ap_int<9> v1128 = v1126;	// L1804
        ap_int<9> v1129 = v1127;	// L1805
        ap_int<9> v1130 = v1128 + v1129;	// L1806
        int8_t v1131 = v1130;	// L1807
        out_right23 = v1131;	// L1808
      } else {
        int8_t v1132 = inst_val23;	// L1810
        int32_t v1133 = v1132;	// L1811
        bool v1134 = v1133 == 2;	// L1812
        if (v1134) {	// L1813
          int8_t v1135 = in_left23;	// L1814
          int8_t v1136 = in_right23;	// L1815
          ap_int<9> v1137 = v1135;	// L1816
          ap_int<9> v1138 = v1136;	// L1817
          ap_int<9> v1139 = v1137 + v1138;	// L1818
          int8_t v1140 = v1139;	// L1819
          out_left23 = v1140;	// L1820
          int8_t v1141 = in_right23;	// L1821
          out_right23 = v1141;	// L1822
        } else {
          int8_t v1142 = in_right23;	// L1824
          out_left23 = v1142;	// L1825
          int8_t v1143 = in_left23;	// L1826
          out_right23 = v1143;	// L1827
        }
      }
    }
    int8_t v1144 = out_left23;	// L1831
    v1106.write(v1144);	// L1832
    int8_t v1145 = out_right23;	// L1833
    v1107.write(v1145);	// L1834
  }
}

void output_0(
  int8_t v1146[8][8],
  hls::stream< int8_t >& v1147,
  hls::stream< int8_t >& v1148,
  hls::stream< int8_t >& v1149,
  hls::stream< int8_t >& v1150,
  hls::stream< int8_t >& v1151,
  hls::stream< int8_t >& v1152,
  hls::stream< int8_t >& v1153,
  hls::stream< int8_t >& v1154
) {	// L1838
  #pragma HLS array_partition variable=v1146 complete dim=1

  l_S_d_0_d: for (int d = 0; d < 8; d++) {	// L1839
    int8_t v1156 = v1147.read();	// L1840
    v1146[d][0] = v1156;	// L1841
    int8_t v1157 = v1148.read();	// L1842
    v1146[d][1] = v1157;	// L1843
    int8_t v1158 = v1149.read();	// L1844
    v1146[d][2] = v1158;	// L1845
    int8_t v1159 = v1150.read();	// L1846
    v1146[d][3] = v1159;	// L1847
    int8_t v1160 = v1151.read();	// L1848
    v1146[d][4] = v1160;	// L1849
    int8_t v1161 = v1152.read();	// L1850
    v1146[d][5] = v1161;	// L1851
    int8_t v1162 = v1153.read();	// L1852
    v1146[d][6] = v1162;	// L1853
    int8_t v1163 = v1154.read();	// L1854
    v1146[d][7] = v1163;	// L1855
  }
}

void load_buf0(
  int8_t v1164[64],
  int8_t v1165[8][8]
) {	//
  #pragma HLS array_partition variable=v1165 complete dim=1

  l_S_load_buf0_load_buf0_l_0: for (int load_buf0_l_0 = 0; load_buf0_l_0 < 8; load_buf0_l_0++) {	//
    l_load_buf0_l_1: for (int load_buf0_l_1 = 0; load_buf0_l_1 < 8; load_buf0_l_1++) {	//
    #pragma HLS pipeline II=1 rewind
      int8_t v1168 = v1164[((load_buf0_l_0 * 8) + load_buf0_l_1)];	//
      v1165[load_buf0_l_0][load_buf0_l_1] = v1168;	//
    }
  }
}

void load_buf1(
  int8_t v1169[512],
  int8_t v1170[8][8][8]
) {	//
  #pragma HLS array_partition variable=v1170 complete dim=1
  #pragma HLS array_partition variable=v1170 complete dim=2
  #pragma HLS array_partition variable=v1170 complete dim=3

  l_S_load_buf1_load_buf1_l_0: for (int load_buf1_l_0 = 0; load_buf1_l_0 < 8; load_buf1_l_0++) {	//
    l_load_buf1_l_1: for (int load_buf1_l_1 = 0; load_buf1_l_1 < 8; load_buf1_l_1++) {	//
      l_load_buf1_l_2: for (int load_buf1_l_2 = 0; load_buf1_l_2 < 8; load_buf1_l_2++) {	//
      #pragma HLS pipeline II=1 rewind
        int8_t v1174 = v1169[(((load_buf1_l_0 * 64) + (load_buf1_l_1 * 8)) + load_buf1_l_2)];	//
        v1170[load_buf1_l_0][load_buf1_l_1][load_buf1_l_2] = v1174;	//
      }
    }
  }
}

void load_buf2(
  int8_t v1175[24],
  int8_t v1176[6][4]
) {	//
  l_S_load_buf2_load_buf2_l_0: for (int load_buf2_l_0 = 0; load_buf2_l_0 < 6; load_buf2_l_0++) {	//
    l_load_buf2_l_1: for (int load_buf2_l_1 = 0; load_buf2_l_1 < 4; load_buf2_l_1++) {	//
    #pragma HLS pipeline II=1 rewind
      int8_t v1179 = v1175[((load_buf2_l_0 * 4) + load_buf2_l_1)];	//
      v1176[load_buf2_l_0][load_buf2_l_1] = v1179;	//
    }
  }
}

void store_res3(
  int8_t v1180[8][8],
  int8_t v1181[64]
) {	//
  #pragma HLS array_partition variable=v1180 complete dim=1

  l_S_store_res3_store_res3_l_0: for (int store_res3_l_0 = 0; store_res3_l_0 < 8; store_res3_l_0++) {	//
    l_store_res3_l_1: for (int store_res3_l_1 = 0; store_res3_l_1 < 8; store_res3_l_1++) {	//
    #pragma HLS pipeline II=1 rewind
      int8_t v1184 = v1180[store_res3_l_0][store_res3_l_1];	//
      v1181[((store_res3_l_0 * 8) + store_res3_l_1)] = v1184;	//
    }
  }
}

/// This is top function.
void top(
  int8_t *v1185,
  int8_t *v1186,
  int8_t *v1187,
  int8_t *v1188
) {	// L1859
  #pragma HLS interface m_axi port=v1185 offset=slave bundle=gmem0
  #pragma HLS interface m_axi port=v1186 offset=slave bundle=gmem1
  #pragma HLS interface m_axi port=v1187 offset=slave bundle=gmem2
  #pragma HLS interface m_axi port=v1188 offset=slave bundle=gmem3
  #pragma HLS dataflow
  int8_t buf0[8][8];	//
  #pragma HLS array_partition variable=buf0 complete dim=1

  load_buf0(v1185, buf0);	//
  int8_t buf1[8][8][8];	//
  #pragma HLS array_partition variable=buf1 complete dim=1
  #pragma HLS array_partition variable=buf1 complete dim=2
  #pragma HLS array_partition variable=buf1 complete dim=3

  load_buf1(v1186, buf1);	//
  int8_t buf2[6][4];	//
  load_buf2(v1187, buf2);	//
  int8_t buf3[8][8];	//
  #pragma HLS array_partition variable=buf3 complete dim=1

  hls::stream< uint64_t > v1193;
  #pragma HLS stream variable=v1193 depth=8	// L1860
  hls::stream< int8_t > v1194;
  #pragma HLS stream variable=v1194 depth=1	// L1861
  hls::stream< int8_t > v1195;
  #pragma HLS stream variable=v1195 depth=1	// L1862
  hls::stream< int8_t > v1196;
  #pragma HLS stream variable=v1196 depth=1	// L1863
  hls::stream< int8_t > v1197;
  #pragma HLS stream variable=v1197 depth=1	// L1864
  hls::stream< int8_t > v1198;
  #pragma HLS stream variable=v1198 depth=1	// L1865
  hls::stream< int8_t > v1199;
  #pragma HLS stream variable=v1199 depth=1	// L1866
  hls::stream< int8_t > v1200;
  #pragma HLS stream variable=v1200 depth=1	// L1867
  hls::stream< int8_t > v1201;
  #pragma HLS stream variable=v1201 depth=1	// L1868
  hls::stream< int8_t > v1202;
  #pragma HLS stream variable=v1202 depth=1	// L1869
  hls::stream< int8_t > v1203;
  #pragma HLS stream variable=v1203 depth=1	// L1870
  hls::stream< int8_t > v1204;
  #pragma HLS stream variable=v1204 depth=1	// L1871
  hls::stream< int8_t > v1205;
  #pragma HLS stream variable=v1205 depth=1	// L1872
  hls::stream< int8_t > v1206;
  #pragma HLS stream variable=v1206 depth=1	// L1873
  hls::stream< int8_t > v1207;
  #pragma HLS stream variable=v1207 depth=1	// L1874
  hls::stream< int8_t > v1208;
  #pragma HLS stream variable=v1208 depth=1	// L1875
  hls::stream< int8_t > v1209;
  #pragma HLS stream variable=v1209 depth=1	// L1876
  hls::stream< int8_t > v1210;
  #pragma HLS stream variable=v1210 depth=1	// L1877
  hls::stream< int8_t > v1211;
  #pragma HLS stream variable=v1211 depth=1	// L1878
  hls::stream< int8_t > v1212;
  #pragma HLS stream variable=v1212 depth=1	// L1879
  hls::stream< int8_t > v1213;
  #pragma HLS stream variable=v1213 depth=1	// L1880
  hls::stream< int8_t > v1214;
  #pragma HLS stream variable=v1214 depth=1	// L1881
  hls::stream< int8_t > v1215;
  #pragma HLS stream variable=v1215 depth=1	// L1882
  hls::stream< int8_t > v1216;
  #pragma HLS stream variable=v1216 depth=1	// L1883
  hls::stream< int8_t > v1217;
  #pragma HLS stream variable=v1217 depth=1	// L1884
  hls::stream< int8_t > v1218;
  #pragma HLS stream variable=v1218 depth=1	// L1885
  hls::stream< int8_t > v1219;
  #pragma HLS stream variable=v1219 depth=1	// L1886
  hls::stream< int8_t > v1220;
  #pragma HLS stream variable=v1220 depth=1	// L1887
  hls::stream< int8_t > v1221;
  #pragma HLS stream variable=v1221 depth=1	// L1888
  hls::stream< int8_t > v1222;
  #pragma HLS stream variable=v1222 depth=1	// L1889
  hls::stream< int8_t > v1223;
  #pragma HLS stream variable=v1223 depth=1	// L1890
  hls::stream< int8_t > v1224;
  #pragma HLS stream variable=v1224 depth=1	// L1891
  hls::stream< int8_t > v1225;
  #pragma HLS stream variable=v1225 depth=1	// L1892
  hls::stream< int8_t > v1226;
  #pragma HLS stream variable=v1226 depth=1	// L1893
  hls::stream< int8_t > v1227;
  #pragma HLS stream variable=v1227 depth=1	// L1894
  hls::stream< int8_t > v1228;
  #pragma HLS stream variable=v1228 depth=1	// L1895
  hls::stream< int8_t > v1229;
  #pragma HLS stream variable=v1229 depth=1	// L1896
  hls::stream< int8_t > v1230;
  #pragma HLS stream variable=v1230 depth=1	// L1897
  hls::stream< int8_t > v1231;
  #pragma HLS stream variable=v1231 depth=1	// L1898
  hls::stream< int8_t > v1232;
  #pragma HLS stream variable=v1232 depth=1	// L1899
  hls::stream< int8_t > v1233;
  #pragma HLS stream variable=v1233 depth=1	// L1900
  hls::stream< int8_t > v1234;
  #pragma HLS stream variable=v1234 depth=1	// L1901
  hls::stream< int8_t > v1235;
  #pragma HLS stream variable=v1235 depth=1	// L1902
  hls::stream< int8_t > v1236;
  #pragma HLS stream variable=v1236 depth=1	// L1903
  hls::stream< int8_t > v1237;
  #pragma HLS stream variable=v1237 depth=1	// L1904
  hls::stream< int8_t > v1238;
  #pragma HLS stream variable=v1238 depth=1	// L1905
  hls::stream< int8_t > v1239;
  #pragma HLS stream variable=v1239 depth=1	// L1906
  hls::stream< int8_t > v1240;
  #pragma HLS stream variable=v1240 depth=1	// L1907
  hls::stream< int8_t > v1241;
  #pragma HLS stream variable=v1241 depth=1	// L1908
  hls::stream< int8_t > v1242;
  #pragma HLS stream variable=v1242 depth=1	// L1909
  hls::stream< int8_t > v1243;
  #pragma HLS stream variable=v1243 depth=1	// L1910
  hls::stream< int8_t > v1244;
  #pragma HLS stream variable=v1244 depth=1	// L1911
  hls::stream< int8_t > v1245;
  #pragma HLS stream variable=v1245 depth=1	// L1912
  hls::stream< int8_t > v1246;
  #pragma HLS stream variable=v1246 depth=1	// L1913
  hls::stream< int8_t > v1247;
  #pragma HLS stream variable=v1247 depth=1	// L1914
  hls::stream< int8_t > v1248;
  #pragma HLS stream variable=v1248 depth=1	// L1915
  hls::stream< int8_t > v1249;
  #pragma HLS stream variable=v1249 depth=1	// L1916
  hls::stream< int8_t > v1250;
  #pragma HLS stream variable=v1250 depth=1	// L1917
  hls::stream< int8_t > v1251;
  #pragma HLS stream variable=v1251 depth=1	// L1918
  hls::stream< int8_t > v1252;
  #pragma HLS stream variable=v1252 depth=1	// L1919
  hls::stream< int8_t > v1253;
  #pragma HLS stream variable=v1253 depth=1	// L1920
  hls::stream< int8_t > v1254;
  #pragma HLS stream variable=v1254 depth=1	// L1921
  hls::stream< int8_t > v1255;
  #pragma HLS stream variable=v1255 depth=1	// L1922
  hls::stream< int8_t > v1256;
  #pragma HLS stream variable=v1256 depth=1	// L1923
  hls::stream< int8_t > v1257;
  #pragma HLS stream variable=v1257 depth=1	// L1924
  hls::stream< int8_t > v1258;
  #pragma HLS stream variable=v1258 depth=1	// L1925
  hls::stream< int8_t > v1259;
  #pragma HLS stream variable=v1259 depth=1	// L1926
  hls::stream< int8_t > v1260;
  #pragma HLS stream variable=v1260 depth=1	// L1927
  hls::stream< int8_t > v1261;
  #pragma HLS stream variable=v1261 depth=1	// L1928
  hls::stream< int8_t > v1262;
  #pragma HLS stream variable=v1262 depth=1	// L1929
  hls::stream< int8_t > v1263;
  #pragma HLS stream variable=v1263 depth=1	// L1930
  hls::stream< int8_t > v1264;
  #pragma HLS stream variable=v1264 depth=1	// L1931
  hls::stream< int8_t > v1265;
  #pragma HLS stream variable=v1265 depth=1	// L1932
  hls::stream< int8_t > v1266;
  #pragma HLS stream variable=v1266 depth=1	// L1933
  hls::stream< int8_t > v1267;
  #pragma HLS stream variable=v1267 depth=1	// L1934
  hls::stream< int8_t > v1268;
  #pragma HLS stream variable=v1268 depth=1	// L1935
  hls::stream< int8_t > v1269;
  #pragma HLS stream variable=v1269 depth=1	// L1936
  hls::stream< int8_t > v1270;
  #pragma HLS stream variable=v1270 depth=1	// L1937
  hls::stream< int8_t > v1271;
  #pragma HLS stream variable=v1271 depth=1	// L1938
  hls::stream< int8_t > v1272;
  #pragma HLS stream variable=v1272 depth=1	// L1939
  hls::stream< int8_t > v1273;
  #pragma HLS stream variable=v1273 depth=1	// L1940
  NEST_0(buf0, buf1, v1193);	// L1941
  bus_0(v1193, v1194, v1195, v1196, v1197, v1198, v1199, v1200, v1201);	// L1942
  inst_rw_0(buf2, v1250, v1251, v1252, v1253, v1254, v1255, v1256, v1257, v1258, v1259, v1260, v1261, v1262, v1263, v1264, v1265, v1266, v1267, v1268, v1269, v1270, v1271, v1272, v1273);	// L1943
  BIRRD_0_0(v1250, v1194, v1195, v1202, v1204);	// L1944
  BIRRD_0_1(v1251, v1196, v1197, v1203, v1205);	// L1945
  BIRRD_0_2(v1252, v1198, v1199, v1206, v1208);	// L1946
  BIRRD_0_3(v1253, v1200, v1201, v1207, v1209);	// L1947
  BIRRD_1_0(v1254, v1202, v1203, v1210, v1214);	// L1948
  BIRRD_1_1(v1255, v1204, v1205, v1212, v1216);	// L1949
  BIRRD_1_2(v1256, v1206, v1207, v1211, v1215);	// L1950
  BIRRD_1_3(v1257, v1208, v1209, v1213, v1217);	// L1951
  BIRRD_2_0(v1258, v1210, v1211, v1218, v1222);	// L1952
  BIRRD_2_1(v1259, v1212, v1213, v1220, v1224);	// L1953
  BIRRD_2_2(v1260, v1214, v1215, v1219, v1223);	// L1954
  BIRRD_2_3(v1261, v1216, v1217, v1221, v1225);	// L1955
  BIRRD_3_0(v1262, v1218, v1219, v1226, v1230);	// L1956
  BIRRD_3_1(v1263, v1220, v1221, v1228, v1232);	// L1957
  BIRRD_3_2(v1264, v1222, v1223, v1227, v1231);	// L1958
  BIRRD_3_3(v1265, v1224, v1225, v1229, v1233);	// L1959
  BIRRD_4_0(v1266, v1226, v1227, v1234, v1236);	// L1960
  BIRRD_4_1(v1267, v1228, v1229, v1235, v1237);	// L1961
  BIRRD_4_2(v1268, v1230, v1231, v1238, v1240);	// L1962
  BIRRD_4_3(v1269, v1232, v1233, v1239, v1241);	// L1963
  BIRRD_5_0(v1270, v1234, v1235, v1242, v1243);	// L1964
  BIRRD_5_1(v1271, v1236, v1237, v1244, v1245);	// L1965
  BIRRD_5_2(v1272, v1238, v1239, v1246, v1247);	// L1966
  BIRRD_5_3(v1273, v1240, v1241, v1248, v1249);	// L1967
  output_0(buf3, v1242, v1243, v1244, v1245, v1246, v1247, v1248, v1249);	// L1968
  store_res3(buf3, v1188);	//
}


} // extern "C"
