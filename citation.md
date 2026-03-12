If you use FEATHER/MINISA in your research, please cite our paper:

@inproceedings{tong2026MINISA,
author = {Tong, Jianming and Li, Yujie and Jain, Devansh and Mendis, Charith and Krishna, Tushar},
title = {MINISA: Minimal Instruction Set Architecture for Next-gen Reconfigurable Inference Accelerator},
year = {2026},
booktitle = {Proceedings of the 34th Annual International Symposium on Performance Analysis of Systems and Software},
keywords = {minimal instruction set architecture, reconfigurable accelerator, virtual neurons},
location = {Seoul, Korea},
series = {ISPASS '26}
}

@inproceedings{tong2024FEATHER,
author = {Tong, Jianming and Itagi, Anirudh and Chatarasi, Parsanth and Krishna, Tushar},
title = {FEATHER: A Reconfigurable Accelerator with Data Reordering Support for Low-Cost
On-Chip
Dataflow Switching},
year = {2024},
publisher = {Association for Computing Machinery},
address = {Argentina},
abstract = {The inference of ML models composed of diverse structures, types, and sizes
boils
down to the execution of different dataflows (i.e. different tiling, ordering,
parallelism,
and
shapes). Using the optimal dataflow for every layer of workload can reduce latency by up
to
two
orders of magnitude over a suboptimal dataflow. Unfortunately, reconfiguring hardware for
different dataflows involves on-chip data layout reordering and datapath reconfigurations,
leading to non-trivial overhead that hinders ML accelerators from exploiting different
dataflows, resulting in suboptimal performance. To address this challenge, we propose
FEATHER,
an innovative accelerator that leverages a novel spatial array termed Nest and a novel
multi-stage reduction network called BIRRD for performing flexible data reduction with
layout
reordering under the hood, enabling seamless switching between optimal dataflows with
negligible
latency and resources overhead. For systematically evaluating the performance interaction
between dataflows and layouts, we enhance Timeloop, a state-of-the-art dataflow cost
modeling
and search framework, with layout assessment capabilities, and term it as Layoutloop. We
model
FEATHER into Layoutloop and also deploy FEATHER end-to-end on the edge ZCU104 FPGA.
FEATHER
delivers 1.27~2.89x inference latency speedup and 1.3~6.43x energy efficiency improvement
compared to various SoTAs like NVDLA, SIGMA and Eyeriss under ResNet-50 and MobiletNet-V3
in
Layoutloop. On practical FPGA devices, FEATHER achieves 2.65/3.91x higher throughput than
Xilinx
DPU/Gemmini. Remarkably, such performance and energy efficiency enhancements come at only
6%
area over a fixed-dataflow Eyeriss-like accelerator.},
booktitle = {Proceedings of the 51th Annual International Symposium on Computer
Architecture},
keywords = {flexible accelerator, dataflow-layout coswitching},
location = {Argentina},
series = {ISCA '24}
}

Please refer to our [PLDI'24 paper](https://dl.acm.org/doi/10.1145/3656401) for more details. If you use Allo in your research, please cite our paper:
@article{chen2024allo,
  author       = {Chen, Hongzheng and Zhang, Niansong and Xiang, Shaojie and Zeng, Zhichen and Dai, Mengjia and Zhang, Zhiru},
  title        = {Allo: A Programming Model for Composable Accelerator Design},
  journal      = {Proceedings of the ACM on Programming Languages},
  volume       = {8},
  number       = {PLDI},
  articleno    = {171},
  year         = {2024},
  month        = jun,
  publisher    = {ACM},
  doi          = {10.1145/3656401}
}

@article{fang2025dato,
  author       = {Fang, Shihan and Chen, Hongzheng and Zhang, Niansong and Li, Jiajie and Meng, Han and Liu, Adrian and Zhang, Zhiru},
  title        = {Dato: A Task-Based Programming Model for Dataflow Accelerators},
  journal      = {arXiv preprint arXiv:2509.06794},
  year         = {2025},
  url          = {https://arxiv.org/abs/2509.06794}
}

@inproceedings{zhuang2025aries,
  author       = {Zhuang, Jinming and Xiang, Shaojie and Chen, Hongzheng and Zhang, Niansong and Yang, Zhuoping and Mao, Tony and Zhang, Zhiru and Zhou, Peipei},
  title        = {ARIES: An Agile MLIR-Based Compilation Flow for Reconfigurable Devices with AI Engines},
  booktitle    = {Proceedings of the ACM/SIGDA International Symposium on Field-Programmable Gate Arrays},
  series       = {FPGA},
  year         = {2025},
  publisher    = {ACM},
  note         = {Best Paper Nominee}
}

@inproceedings{pouchet2024formal,
  author       = {Pouchet, Louis-No{\"e}l and Tucker, Emily and Zhang, Niansong and Chen, Hongzheng and Pal, Debjit and Rodr{\'i}guez, Gabriel and Zhang, Zhiru},
  title        = {Formal Verification of Source-to-Source Transformations for HLS},
  booktitle    = {Proceedings of the ACM/SIGDA International Symposium on Field-Programmable Gate Arrays},
  series       = {FPGA},
  year         = {2024},
  publisher    = {ACM},
  note         = {Best Paper Award}
}

@article{chen2024llmfpga,
  author       = {Chen, Hongzheng and Zhang, Jiahao and Du, Yixiao and Xiang, Shaojie and Yue, Zichao and Zhang, Niansong and Cai, Yaohui and Zhang, Zhiru},
  title        = {Understanding the Potential of FPGA-Based Spatial Acceleration for Large Language Model Inference},
  journal      = {ACM Transactions on Reconfigurable Technology and Systems},
  year         = {2024},
  publisher    = {ACM},
  note         = {FCCM 2024 Journal Track}
}

