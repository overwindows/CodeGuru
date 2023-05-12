import os
import argparse
import azure_openai
import word_to_markdown
import logging
import sys
import image_to_text


def main():
    script_path = os.path.realpath(__file__)
    proj_root = os.path.dirname(os.path.dirname(script_path))
    parser = argparse.ArgumentParser()
    parser.add_argument('docx_path', help='Path to the design document to analyze.')
    parser.add_argument(
        '-m', '--markdown_path',
        default=os.path.join(proj_root, 'docs', 'markdown'),
        help='Path to markdown output. The markdown file will be placed here, '
             'and its related media files (e.g., images) will be placed under a sub-folder media.')
    parser.add_argument(
        '-o', '--output_path',
        default=os.path.join(proj_root, 'output'), help='Path to code output.')
    args = parser.parse_args()

    if not os.path.exists(args.docx_path):
        logging.log(logging.ERROR, 'The design document path {} does not exist.'.format(args.docx_path))
        return

    logging.log(logging.INFO, 'Creating output paths...')
    os.makedirs(args.markdown_path, exist_ok=True)
    os.makedirs(args.output_path, exist_ok=True)
    logging.log(logging.INFO, 'Created output paths')

    logging.log(logging.INFO, 'Converting docx to markdown...')

    extracted_md_path = word_to_markdown.extract(args.docx_path, args.markdown_path)

    # TODO: Extract text from all images, where images are in args.markdown_path/media
    #  Then, construct a dict mapping image_path to its description.
    #  Finally, call word_to_markdown.embed_image_description(
    #  extracted_md_path, the dictionary, description-embedded output md file path)
    logging.log(logging.INFO, f'Converted markdown to {args.markdown_path}')

    # Open AI example
    oai = azure_openai.AzureOpenAI()
    session_id = oai.create_session()
    print(oai.ask_question("Hello", session_id=session_id))
    print(oai.ask_question("What was my last message?", session_id=session_id))

    print('Converting images to text...')
    image_path = "Salesforce/blip-image-captioning-large"
    image_to_text_obj = image_to_text.ImageToText(image_path)
    image_to_text_obj.convert(args.image_path, args.output_path)


if __name__ == "__main__":
    # Uncomment this line to log to stdout
    # logging.basicConfig(stream=sys.stdout, level=logging.INFO)
    main()
