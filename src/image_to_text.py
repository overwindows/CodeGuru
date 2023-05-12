# Create a class to convert image to text
# Author: Chen Wu
# Date: 05/10/2023
# Version: 1.0

import requests
from PIL import Image
from transformers import Blip2Processor, Blip2ForConditionalGeneration,Blip2Config, Blip2PreTrainedModel
from accelerate import infer_auto_device_map, init_empty_weights
from transformers import AutoConfig

class ImageToText:
    def __init__(self, model_name):
        # self.config = Blip2Config.from_pretrained(model_name)
        # # print(self.config)
        # with init_empty_weights():
        #     model = Blip2ForConditionalGeneration._from_config(self.config)
        # device_map = infer_auto_device_map(model)
        # print(device_map)
        # for k, v in device_map.items():
        #     if v == 'cpu':
        #         device_map[k] = "disk"
        # print(device_map)
        self.processor = Blip2Processor.from_pretrained(model_name)
        # self.model = Blip2ForConditionalGeneration.from_pretrained(model_name）
        self.model = Blip2ForConditionalGeneration.from_pretrained(model_name, device_map='auto', offload_folder="offload")

    def convert_one(self, input_image_path = None): 
        raw_image = Image.open(input_image_path)
        question = "describe the image, what is it about?"
        inputs = self.processor(raw_image, question, return_tensors="pt")

        out = self.model.generate(**inputs)

        print(self.processor.decode(out[0], skip_special_tokens=True))

if __name__ == "__main__":
    image_to_text = ImageToText("Salesforce/blip2-opt-2.7b")
    img_path = r"/mnt/c/Users/wuc/Desktop/PoC.png"
    image_to_text.convert_one(img_path)